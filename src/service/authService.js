import { z } from 'zod';

import { getSupabaseClient } from '../config/supabase.js';
import { findProfileById, findProfileByUsername } from '../repository/profileRepository.js';
import { AppError } from '../utils/httpError.js';

// No Zod 4, a mensagem de campo ausente ou de tipo errado vem da opção "error".
// (As opções antigas required_error e invalid_type_error são ignoradas sem aviso.)
const textField = (requiredMessage, typeMessage) => z.string({
  error: (issue) => (issue.input === undefined ? requiredMessage : typeMessage)
});

export const registerUserSchema = z.object({
  // Mesma regra do banco (migração 0001): 3 a 20 caracteres, só letras, números e "_".
  // O tamanho é conferido por min/max; o "*" no regex evita repetir o erro de um nome vazio.
  username: textField('Nome de usuário é obrigatório.', 'Nome de usuário deve ser um texto.')
    .trim()
    .min(3, 'Nome de usuário deve ter pelo menos 3 caracteres.')
    .max(20, 'Nome de usuário deve ter no máximo 20 caracteres.')
    .regex(/^[A-Za-z0-9_]*$/, 'Nome de usuário só pode conter letras, números e underscore (_).'),
  email: textField('E-mail é obrigatório.', 'E-mail deve ser um texto.')
    .trim()
    .toLowerCase()
    .email('E-mail inválido.'),
  // A senha NÃO passa por trim: vai para o Supabase exatamente como foi digitada.
  // 72 é o limite do Supabase Auth. "abort" evita uma segunda mensagem para a mesma senha.
  password: textField('Senha é obrigatória.', 'Senha deve ser um texto.')
    .min(8, { error: 'Senha deve ter pelo menos 8 caracteres.', abort: true })
    .max(72, { error: 'Senha deve ter no máximo 72 caracteres.', abort: true })
    .refine((password) => password.trim().length > 0, 'Senha não pode conter apenas espaços.')
}, { error: 'O corpo da requisição deve ser um objeto JSON.' });

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

// Cadastro de jogador. Os dados chegam já validados pelo controller (registerUserSchema).
// O Supabase Auth cria a conta, e o gatilho on_auth_user_created (migração 0001) cria o
// perfil NA MESMA TRANSAÇÃO. Por isso, quando o signUp responde, o perfil já existe.
export const registerUser = async ({ username, email, password }, context = {}) => {
  const repository = {
    usernameExists: findProfileByUsername,
    findProfileById,
    ...(context.repo ?? {})
  };

  // 1. Nome já usado (sem diferenciar maiúsculas): recusa ANTES de criar a conta.
  let existingProfile;
  try {
    console.info('[auth:register] stage=username_lookup_start');
    existingProfile = await repository.usernameExists(username);
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    console.error('[auth:register] stage=username_lookup errorCode=PROFILE_CHECK_FAILED');
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

  // 2. Cria a conta. O signUp é chamado uma única vez: nunca é repetido.
  const supabase = context.supabase ?? getSupabaseClient();

  console.info('[auth:register] stage=supabase_sign_up');
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { username }
    }
  });

  if (error) {
    console.error('[auth:register] stage=supabase_sign_up_error errorCode=' + (error.code ?? 'AUTH_SIGNUP_ERROR'));
    throw buildAuthError(error);
  }

  const user = data?.user ?? null;
  if (!user?.id) {
    throw new AppError({
      statusCode: 502,
      code: 'AUTH_REGISTRATION_INCOMPLETE',
      message: 'O Supabase Auth não devolveu o usuário cadastrado.'
    });
  }

  // 3. E-mail já cadastrado com "Confirm email" ligado: o Supabase não devolve erro.
  //    Para esconder quem tem conta, ele responde com um usuário FALSO (id aleatório e
  //    identities vazio). Esse id não existe, então nem procuramos o perfil.
  //    Decisão do projeto: responder 409, como quando a confirmação está desligada.
  if (Array.isArray(user.identities) && user.identities.length === 0) {
    console.info('[auth:register] stage=email_already_registered');
    throw new AppError({
      statusCode: 409,
      code: 'AUTH_USER_ALREADY_EXISTS',
      message: 'Este e-mail já está cadastrado.'
    });
  }

  // 4. O perfil foi criado na mesma transação da conta: uma leitura basta.
  //    Se ele não existir, o gatilho não está instalado (erro de configuração, não temporário).
  const profile = await repository.findProfileById(user.id);
  if (!profile) {
    throw new AppError({
      statusCode: 502,
      code: 'PROFILE_NOT_CREATED',
      message: 'A conta foi criada, mas o perfil não existe. Confira se a migração 0001 (gatilho on_auth_user_created) foi aplicada.'
    });
  }

  // 5. Se outro cadastro ocupou o nome no mesmo instante, o gatilho grava um nome
  //    provisório (jogador_...) em vez de bloquear. A conta JÁ existe, então isso é sucesso:
  //    devolvemos o nome real e avisamos com usernameChanged.
  const usernameChanged = profile.username.toLowerCase() !== username.toLowerCase();

  return {
    status: data.session ? 'registered' : 'pending_email_confirmation',
    requiresEmailConfirmation: !data.session,
    usernameChanged,
    user: {
      id: user.id,
      email: user.email
    },
    profile: {
      id: profile.id,
      username: profile.username
    }
  };
};
