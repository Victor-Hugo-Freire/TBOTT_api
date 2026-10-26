import { isAuthApiError, isAuthSessionMissingError } from '@supabase/supabase-js';
import { z } from 'zod';

import { createSupabaseClient } from '../config/supabase.js';
import { findProfileById, findProfileByUsername } from '../repository/profileRepository.js';
import { AppError } from '../utils/httpError.js';

// No Zod 4, a mensagem de campo ausente ou de tipo errado vem da opção "error".
// (As opções antigas required_error e invalid_type_error são ignoradas sem aviso.)
const textField = (requiredMessage, typeMessage) => z.string({
  error: (issue) => (issue.input === undefined ? requiredMessage : typeMessage)
});

// Mesma regra no cadastro e no login: sem espaços nas pontas e em minúsculas.
const emailField = textField('E-mail é obrigatório.', 'E-mail deve ser um texto.')
  .trim()
  .toLowerCase()
  .email('E-mail inválido.');

export const registerUserSchema = z.object({
  // Mesma regra do banco (migração 0001): 3 a 20 caracteres, só letras, números e "_".
  // O tamanho é conferido por min/max; o "*" no regex evita repetir o erro de um nome vazio.
  username: textField('Nome de usuário é obrigatório.', 'Nome de usuário deve ser um texto.')
    .trim()
    .min(3, 'Nome de usuário deve ter pelo menos 3 caracteres.')
    .max(20, 'Nome de usuário deve ter no máximo 20 caracteres.')
    .regex(/^[A-Za-z0-9_]*$/, 'Nome de usuário só pode conter letras, números e underscore (_).'),
  email: emailField,
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

// Só o que o front-end precisa. Tokens e metadados internos do Supabase ficam de fora.
const toPublicUser = (user) => ({ id: user.id, email: user.email });
const toPublicProfile = (profile) => ({ id: profile.id, username: profile.username });

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
  const supabase = context.supabase ?? createSupabaseClient();

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
    user: toPublicUser(user),
    profile: toPublicProfile(profile)
  };
};

// ---------------------------------------------------------------------------------------
// Login, sessão e logout (issue #8)
//
// A sessão do Supabase tem dois tokens, guardados em cookies httpOnly pelo controller e pelo
// middleware (veja src/utils/sessionCookies.js):
// - access token: JWT de vida curta (1 hora no padrão do Supabase), prova quem é o jogador;
// - refresh token: troca-se por um par novo quando o access token vence. Cada um vale UMA vez.
// ---------------------------------------------------------------------------------------

// Login: confere só se os campos vieram preenchidos. As regras de tamanho do cadastro não
// valem aqui, porque uma conta criada pelo painel do Supabase pode ter senha mais curta.
// A senha também não passa por trim.
export const loginSchema = z.object({
  email: emailField,
  password: textField('Senha é obrigatória.', 'Senha deve ser um texto.')
    .min(1, 'Senha é obrigatória.')
    .max(72, 'Senha deve ter no máximo 72 caracteres.')
}, { error: 'O corpo da requisição deve ser um objeto JSON.' });

const supabaseUnavailableError = () => new AppError({
  statusCode: 503,
  code: 'SUPABASE_UNAVAILABLE',
  message: 'Serviço de autenticação indisponível no momento.'
});

const rateLimitedError = () => new AppError({
  statusCode: 429,
  code: 'AUTH_RATE_LIMITED',
  message: 'Muitas tentativas em pouco tempo. Tente novamente mais tarde.'
});

const sessionExpiredError = () => new AppError({
  statusCode: 401,
  code: 'AUTH_SESSION_EXPIRED',
  message: 'Sua sessão expirou. Faça login novamente.'
});

// Toda conta deveria ter perfil (o gatilho cria os dois juntos). Se não tem, é erro de
// configuração do banco, não do jogador: 500, com a dica só no log.
const profileNotFoundError = () => new AppError({
  statusCode: 500,
  code: 'PROFILE_NOT_FOUND',
  message: 'A conta existe, mas o perfil não. Confira se a migração 0001 (gatilho on_auth_user_created) foi aplicada antes de a conta ser criada.'
});

// O Supabase recomenda identificar os erros pelo código (error.code), não pela mensagem.
const isRateLimited = (error) => error.code === 'over_request_rate_limit' || error.status === 429;

// O Supabase Auth respondeu e recusou o token: inválido, vencido, sessão encerrada ou refresh
// token já usado. Falhas de rede e erros 5xx (AuthRetryableFetchError) ficam de fora: neles a
// sessão pode continuar válida, e apagar os cookies deslogaria o jogador à toa.
const isSessionRejected = (error) => (
  (isAuthApiError(error) && error.status < 500 && !isRateLimited(error)) || isAuthSessionMissingError(error)
);

const toSessionError = (error) => {
  if (isSessionRejected(error)) {
    return sessionExpiredError();
  }

  return isRateLimited(error) ? rateLimitedError() : supabaseUnavailableError();
};

const buildLoginError = (error) => {
  if (error.code === 'invalid_credentials') {
    // A mesma resposta para e-mail sem conta e para senha errada: não revela quem tem conta.
    return new AppError({
      statusCode: 401,
      code: 'INVALID_CREDENTIALS',
      message: 'E-mail ou senha incorretos.'
    });
  }

  if (error.code === 'email_not_confirmed') {
    // O Supabase só dá este erro depois de conferir a senha: quem não a sabe não descobre a conta.
    return new AppError({
      statusCode: 403,
      code: 'EMAIL_NOT_CONFIRMED',
      message: 'Confirme seu e-mail antes de entrar. Use o link enviado no cadastro.'
    });
  }

  if (isRateLimited(error)) {
    return rateLimitedError();
  }

  if (!isAuthApiError(error) || error.status >= 500) {
    return supabaseUnavailableError();
  }

  return new AppError({
    statusCode: 400,
    code: 'AUTH_LOGIN_FAILED',
    message: 'Não foi possível entrar no momento.'
  });
};

// Encerra no Supabase só a sessão deste access token (scope "local"): os outros aparelhos do
// jogador continuam logados. Apesar do nome "admin", este método usa o token do próprio
// jogador, e não uma chave secreta: é o mesmo que o supabase.auth.signOut() chama por dentro.
// Devolve o erro do Supabase (ou null) para quem chamou decidir o que fazer.
const revokeSession = async (supabase, accessToken) => {
  const { error } = await supabase.auth.admin.signOut(accessToken, 'local');
  return error;
};

// Renovações em andamento, indexadas pelo refresh token. Como cada refresh token só pode ser
// trocado uma vez, quando duas requisições do mesmo jogador chegam juntas com o access token
// vencido, só a primeira chama o Supabase e as duas recebem a mesma sessão nova.
// A chave é o próprio token: só quem já o tem recebe o resultado.
const refreshesInProgress = new Map();

const refreshSessionOnce = (supabase, refreshToken) => {
  let refresh = refreshesInProgress.get(refreshToken);

  if (!refresh) {
    refresh = supabase.auth.refreshSession({ refresh_token: refreshToken })
      .finally(() => refreshesInProgress.delete(refreshToken));
    refreshesInProgress.set(refreshToken, refresh);
  }

  return refresh;
};

// Login com e-mail e senha. Os dados chegam já validados pelo controller (loginSchema).
// Devolve a sessão (tokens) separada de user e profile: o controller grava a sessão nos
// cookies e responde só com user e profile.
export const loginUser = async ({ email, password }, context = {}) => {
  // Nos testes, context troca o Supabase e o banco por versões simuladas.
  const supabase = context.supabase ?? createSupabaseClient();
  const repository = {
    findProfileById,
    ...(context.repo ?? {})
  };

  console.info('[auth:login] stage=supabase_sign_in');
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    console.warn(`[auth:login] stage=supabase_sign_in_error errorCode=${error.code ?? error.name}`);
    throw buildLoginError(error);
  }

  const { session, user } = data;

  // O jogo precisa do perfil (o nome do jogador). Sem ele o login não se completa, e a sessão
  // que acabou de ser criada é encerrada para não sobrar um login pela metade.
  let profile;
  try {
    profile = await repository.findProfileById(user.id);
  } catch (lookupError) {
    await revokeSession(supabase, session.access_token);
    throw lookupError;
  }

  if (!profile) {
    await revokeSession(supabase, session.access_token);
    throw profileNotFoundError();
  }

  return {
    session,
    user: toPublicUser(user),
    profile: toPublicProfile(profile)
  };
};

// Confere no Supabase Auth a sessão que veio nos cookies (usado pelo middleware requireAuth).
// Devolve o jogador e, quando o access token precisou ser renovado, a sessão nova
// (renewedSession), que o middleware grava nos cookies da resposta.
export const resolveSession = async ({ accessToken, refreshToken }, context = {}) => {
  const supabase = context.supabase ?? createSupabaseClient();

  if (accessToken) {
    // O getUser pergunta ao servidor do Supabase Auth, que confere a assinatura, a validade e
    // se a sessão ainda existe: depois de um logout, o token é recusado na hora. Só decodificar
    // o JWT aqui na API não detectaria esse logout.
    const { data, error } = await supabase.auth.getUser(accessToken);

    if (!error) {
      return { user: toPublicUser(data.user), renewedSession: null };
    }

    if (!isSessionRejected(error)) {
      console.error(`[auth:session] stage=get_user_error errorCode=${error.code ?? error.name}`);
      throw toSessionError(error);
    }
    // Token vencido ou recusado: segue para a renovação.
  }

  if (!refreshToken) {
    throw sessionExpiredError();
  }

  const { data, error } = await refreshSessionOnce(supabase, refreshToken);

  if (error || !data?.session) {
    console.warn(`[auth:session] stage=refresh_error errorCode=${error?.code ?? error?.name ?? 'NO_SESSION'}`);
    throw error ? toSessionError(error) : sessionExpiredError();
  }

  console.info('[auth:session] stage=token_refreshed');
  return { user: toPublicUser(data.user), renewedSession: data.session };
};

// Dados do card do jogador (GET /api/auth/me). O user chega do requireAuth, já conferido
// no Supabase Auth.
export const getCurrentUser = async (user, context = {}) => {
  const repository = {
    findProfileById,
    ...(context.repo ?? {})
  };

  const profile = await repository.findProfileById(user.id);
  if (!profile) {
    throw profileNotFoundError();
  }

  return {
    user,
    profile: toPublicProfile(profile)
  };
};

const reportLogoutFailure = (error) => {
  console.warn(`[auth:logout] stage=revoke_failed errorCode=${error.code ?? error.name}`);
  return { revoked: false };
};

// Encerra no Supabase a sessão dos cookies, e só ela. O controller apaga os cookies em
// qualquer caso, então o logout nunca prende o jogador. "revoked" diz se o Supabase
// confirmou o encerramento (aparece só nos logs e nos testes).
export const logoutUser = async ({ accessToken, refreshToken }, context = {}) => {
  if (!accessToken && !refreshToken) {
    return { revoked: false };
  }

  const supabase = context.supabase ?? createSupabaseClient();

  // 1. Access token ainda válido: encerra a sessão direto.
  if (accessToken) {
    const error = await revokeSession(supabase, accessToken);

    if (!error) {
      return { revoked: true };
    }

    if (!isSessionRejected(error)) {
      // Supabase fora do ar: renovar também falharia.
      return reportLogoutFailure(error);
    }
  }

  // 2. Access token vencido ou ausente (o cookie dele dura o mesmo que o token): renova só para
  //    conseguir encerrar a sessão. Sem isso, o refresh token continuaria valendo no Supabase.
  if (!refreshToken) {
    return { revoked: false };
  }

  const { data, error } = await refreshSessionOnce(supabase, refreshToken);

  if (error || !data?.session) {
    // Renovação recusada: a sessão já tinha acabado. Outro erro: o Supabase está fora do ar.
    return error && !isSessionRejected(error) ? reportLogoutFailure(error) : { revoked: false };
  }

  const revokeError = await revokeSession(supabase, data.session.access_token);
  return revokeError ? reportLogoutFailure(revokeError) : { revoked: true };
};
