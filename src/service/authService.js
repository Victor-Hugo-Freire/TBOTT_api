import { z } from 'zod';

import { getSupabaseClient } from '../config/supabase.js';
import { findProfileById, findProfileByUsername } from '../repository/profileRepository.js';
import { AppError, normalizeValidationDetails } from '../utils/httpError.js';

const USERNAME_PATTERN = /^[A-Za-z0-9_]{3,20}$/;

export const registerUserSchema = z.object({
  username: z.string({ required_error: 'Nome de usuário é obrigatório.', invalid_type_error: 'Nome de usuário deve ser uma string.' })
    .trim()
    .min(3, 'Nome de usuário deve ter pelo menos 3 caracteres.')
    .max(20, 'Nome de usuário deve ter no máximo 20 caracteres.')
    .regex(USERNAME_PATTERN, 'Nome de usuário só pode conter letras, números e underscore (_).'),
  email: z.string({ required_error: 'E-mail é obrigatório.', invalid_type_error: 'E-mail deve ser uma string.' })
    .trim()
    .toLowerCase()
    .email('E-mail inválido.'),
  password: z.string({ required_error: 'Senha é obrigatória.', invalid_type_error: 'Senha deve ser uma string.' })
    .min(8, 'Senha deve ter pelo menos 8 caracteres.')
    .max(72, 'Senha deve ter no máximo 72 caracteres.')
});

const getSupabaseErrorMessage = (errorLike = {}) => {
  const message = String(errorLike.message ?? errorLike.msg ?? errorLike.error ?? errorLike.code ?? '');

  if (message && message !== 'undefined') {
    return message;
  }

  return 'Não foi possível concluir o cadastro no momento.';
};

const buildAuthError = (errorLike = {}) => {
  const message = getSupabaseErrorMessage(errorLike).toLowerCase();
  const code = String(errorLike.code ?? '').toLowerCase();
  const statusCode = Number.isInteger(errorLike.status) ? errorLike.status : 400;

  const knownCode = code.trim();
  const messageText = message.trim();

  if (knownCode === 'email_address_invalid' || /email_address_invalid|invalid_email_address/i.test(knownCode) || /email.*invalid.*address|invalid.*email.*address/.test(messageText)) {
    return new AppError({
      statusCode: 400,
      code: 'INVALID_EMAIL',
      message: 'Endereço de e-mail inválido ou não aceito para cadastro.'
    });
  }

  if (knownCode === 'user_already_exists' || knownCode === 'email_exists' || /already.*registered|already.*exists|email_exists|user_already_exists|username.*exists/.test(messageText)) {
    return new AppError({
      statusCode: 409,
      code: 'AUTH_USER_ALREADY_EXISTS',
      message: 'Este e-mail já está cadastrado.'
    });
  }

  if (knownCode === 'weak_password' || knownCode === 'invalid_password' || /weak_password|password.*too.*weak|password.*requirements|invalid_password/.test(messageText)) {
    return new AppError({
      statusCode: 422,
      code: 'INVALID_PASSWORD',
      message: 'A senha não atende aos requisitos de segurança.'
    });
  }

  if (knownCode === 'over_request_rate_limit' || knownCode === 'rate_limit_exceeded' || /rate.?limit|too_many_requests|too many requests|rate_limited|over_request/.test(messageText) || /over_request|rate_limit/.test(knownCode)) {
    return new AppError({
      statusCode: 429,
      code: 'AUTH_RATE_LIMITED',
      message: 'Muitas tentativas em pouco tempo. Tente novamente mais tarde.'
    });
  }

  if (statusCode >= 500 || /timed out|timeout|unavailable|temporarily|service unavailable|internal server error|fetch failed/.test(messageText) || /timeout|unavailable|temporarily/.test(knownCode)) {
    return new AppError({
      statusCode: 503,
      code: 'SUPABASE_UNAVAILABLE',
      message: 'Serviço de autenticação indisponível no momento.'
    });
  }

  if (statusCode === 429) {
    return new AppError({
      statusCode: 429,
      code: 'AUTH_RATE_LIMITED',
      message: 'Muitas tentativas em pouco tempo. Tente novamente mais tarde.'
    });
  }

  return new AppError({
    statusCode: 400,
    code: 'AUTH_REGISTRATION_FAILED',
    message: 'Não foi possível concluir o cadastro no momento.'
  });
};

const waitForProfile = async (userId, repo, { attempts = 3, delayMs = 250 } = {}) => {
  let lastProfile = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastProfile = await repo.findProfileById(userId);
    if (lastProfile) {
      return lastProfile;
    }

    if (attempt < attempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return lastProfile;
};

export const registerUser = async (payload, context = {}) => {
  const repository = {
    usernameExists: findProfileByUsername,
    findProfileById,
    ...(context.repo ?? {})
  };

  const validation = registerUserSchema.safeParse(payload);

  if (!validation.success) {
    throw new AppError({
      statusCode: 400,
      code: 'INVALID_REGISTER_DATA',
      message: 'Dados de cadastro inválidos.',
      details: normalizeValidationDetails(validation.error.issues)
    });
  }

  const { username, email, password } = validation.data;

  let existingProfile;
  try {
    console.info('[auth:register] stage=username_lookup_start');
    existingProfile = await repository.usernameExists(username);
  } catch (error) {
    console.error('[auth:register] stage=username_lookup errorCode=' + (error?.code ?? 'PROFILE_CHECK_FAILED'));
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError({
      statusCode: 503,
      code: 'PROFILE_CHECK_FAILED',
      message: 'Não foi possível verificar o nome de usuário no momento.'
    });
  }

  if (existingProfile) {
    throw new AppError({
      statusCode: 409,
      code: 'USERNAME_ALREADY_EXISTS',
      message: 'Nome de usuário já está em uso.'
    });
  }

  const supabase = context.supabase ?? getSupabaseClient();

  try {
    console.info('[auth:register] stage=supabase_sign_up');
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { username }
      }
    });

    if (error) {
      console.error('[auth:register] stage=supabase_sign_up_error errorCode=' + (error?.code ?? 'AUTH_SIGNUP_ERROR'));
      throw buildAuthError(error);
    }

    const user = data?.user ?? null;
    if (!user || !user.id) {
      throw new AppError({
        statusCode: 502,
        code: 'AUTH_REGISTRATION_INCOMPLETE',
        message: 'Cadastro criado no Auth, mas não foi possível validar o usuário retornado.'
      });
    }

    console.info('[auth:register] stage=profile_trigger_wait');
    const profile = await waitForProfile(user.id, repository);
    if (!profile) {
      throw new AppError({
        statusCode: 502,
        code: 'PROFILE_NOT_CREATED',
        message: 'Cadastro concluído no Auth, mas o perfil ainda não está disponível.'
      });
    }

    if (profile.username?.toLowerCase?.() !== username.toLowerCase()) {
      throw new AppError({
        statusCode: 409,
        code: 'USERNAME_ALREADY_EXISTS',
        message: 'Nome de usuário já está em uso.'
      });
    }

    return {
      status: data.session ? 'registered' : 'pending_email_confirmation',
      requiresEmailConfirmation: !data.session,
      user: {
        id: user.id,
        email: user.email
      },
      profile: {
        id: profile.id,
        username: profile.username
      }
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    console.error('[auth:register] stage=supabase_sign_up_error errorCode=' + (error?.code ?? 'AUTH_UNKNOWN_ERROR'));

    throw new AppError({
      statusCode: 503,
      code: 'SUPABASE_TIMEOUT',
      message: 'Serviço de autenticação indisponível no momento.'
    });
  }
};
