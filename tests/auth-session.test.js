import './helpers/fakeEnv.js';

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import { inspect } from 'node:util';

import { AuthApiError, AuthRetryableFetchError, AuthSessionMissingError, AuthUnknownError } from '@supabase/supabase-js';
import express from 'express';

import config, { buildSessionCookieOptions, parseFrontendOrigins } from '../src/config/index.js';
import { createSupabaseClient } from '../src/config/supabase.js';
import { createOriginCheck } from '../src/middleware/checkOrigin.js';
import { loginSchema, loginUser, logoutUser, resolveSession } from '../src/service/authService.js';
import { AppError } from '../src/utils/httpError.js';
import { clearSessionCookies, readSessionCookies, setSessionCookies } from '../src/utils/sessionCookies.js';

const PASSWORD = 'Senha-Teste-123';
const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'jogador@example.com' };
const SESSION = { access_token: 'access-novo', refresh_token: 'refresh-novo', expires_in: 3600, user: USER };

let logLines = [];

// Os services registram etapas no console: os testes capturam as linhas e conferem, no fim de
// cada um, que nenhuma senha, e-mail ou token apareceu.
beforeEach(() => {
  logLines = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    mock.method(console, level, (...args) => {
      logLines.push(args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { depth: 5 }))).join(' '));
    });
  }
});

afterEach(() => {
  mock.restoreAll();

  for (const line of logLines) {
    assert.doesNotMatch(line, /Senha-Teste|@example\.com|access-|refresh-/, `dado sensível no log: ${line}`);
  }
});

// Confere o erro completo (status e código), não só que algum erro aconteceu.
const isAppError = (statusCode, code) => (error) => {
  assert.ok(error instanceof AppError, `esperado AppError, recebido ${error?.name}: ${error?.message}`);
  assert.equal(error.statusCode, statusCode);
  assert.equal(error.code, code);
  return true;
};

// Mensagens de validação no formato "campo: mensagem".
const loginMessages = (input) => {
  const result = loginSchema.safeParse(input);
  assert.equal(result.success, false, 'os dados deveriam ser inválidos');
  return result.error.issues.map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`);
};

// Respostas do supabase-js: { data, error }, com as classes de erro reais da biblioteca.
const failure = (error) => ({ data: { user: null, session: null }, error });
const renewed = (session = SESSION) => ({ data: { user: session.user, session }, error: null });

// Supabase falso, só com os métodos que o teste usa. Guarda as chamadas.
const fakeSupabase = ({ getUser, refreshSession, signOut, signInWithPassword } = {}) => {
  const calls = { getUser: 0, refreshSession: [], signOut: [], signInWithPassword: 0 };

  return {
    calls,
    auth: {
      getUser: async (jwt) => {
        calls.getUser += 1;
        return getUser(jwt);
      },
      refreshSession: (input) => {
        calls.refreshSession.push(input.refresh_token);
        return Promise.resolve(refreshSession(input));
      },
      signInWithPassword: async (credentials) => {
        calls.signInWithPassword += 1;
        return signInWithPassword(credentials);
      },
      admin: {
        signOut: async (jwt, scope) => {
          calls.signOut.push(scope);
          return signOut(jwt, scope);
        }
      }
    }
  };
};

// Monta uma resposta real do Express e devolve os Set-Cookie e o Cache-Control que ela enviaria.
const captureResponse = async (writeCookies) => {
  const miniApp = express();
  miniApp.get('/', (_req, res) => {
    writeCookies(res);
    res.end();
  });

  const server = await new Promise((resolve) => {
    const listening = miniApp.listen(0, '127.0.0.1', () => resolve(listening));
  });

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/`);
    return { setCookie: response.headers.getSetCookie(), cacheControl: response.headers.get('cache-control') };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

const attributesOf = (setCookieLine) => setCookieLine.split('; ').slice(1);

describe('configuração de CORS (FRONTEND_ORIGINS)', () => {
  test('sem a variável: em desenvolvimento libera só o Vite; em produção, nenhuma origem', () => {
    assert.deepEqual(parseFrontendOrigins('', { production: false }), ['http://localhost:5173']);
    assert.deepEqual(parseFrontendOrigins(undefined, { production: false }), ['http://localhost:5173']);
    assert.deepEqual(parseFrontendOrigins('', { production: true }), []);
  });

  test('normaliza cada endereço para a origem que o navegador envia (sem barra nem caminho)', () => {
    const origins = parseFrontendOrigins(' http://localhost:5173/ , https://tbott.example.com/jogar ', { production: true });

    assert.deepEqual(origins, ['http://localhost:5173', 'https://tbott.example.com']);
  });

  test('recusa "*" e endereços inválidos, com mensagem clara', () => {
    assert.throws(() => parseFrontendOrigins('*'), /não aceita "\*"/);

    for (const value of ['localhost:5173', 'ftp://tbott.example.com', 'tbott']) {
      assert.throws(() => parseFrontendOrigins(value), /endereço inválido/, value);
    }
  });

  test('a configuração carregada é sempre uma lista (o cors trataria um valor vazio como "*")', () => {
    assert.deepEqual(config.frontendOrigins, ['http://localhost:5173']);
  });
});

describe('cookies de sessão', () => {
  test('desenvolvimento: HttpOnly, SameSite=Lax e Path=/api, sem Secure', () => {
    assert.deepEqual(buildSessionCookieOptions({ production: false }), {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/api'
    });
    assert.deepEqual(config.sessionCookie, buildSessionCookieOptions({ production: false }));
  });

  test('produção: Secure ligado', () => {
    assert.equal(buildSessionCookieOptions({ production: true }).secure, true);
  });

  test('SameSite configurável: strict aceito; none só em produção; outros valores recusados', () => {
    assert.equal(buildSessionCookieOptions({ sameSite: ' Strict ' }).sameSite, 'strict');
    assert.deepEqual(buildSessionCookieOptions({ production: true, sameSite: 'none' }), {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/api'
    });
    assert.throws(() => buildSessionCookieOptions({ production: false, sameSite: 'none' }), /exige cookies Secure/);
    assert.throws(() => buildSessionCookieOptions({ sameSite: 'qualquer' }), /SESSION_COOKIE_SAMESITE inválido/);
  });

  test('Set-Cookie real em produção: Secure, HttpOnly, SameSite=Lax, Path=/api e validades certas', async () => {
    const production = buildSessionCookieOptions({ production: true });

    const { setCookie, cacheControl } = await captureResponse((res) => setSessionCookies(res, SESSION, production));

    assert.equal(setCookie.length, 2);
    assert.ok(setCookie[0].startsWith('tbott_access_token=access-novo;'));
    assert.ok(setCookie[1].startsWith('tbott_refresh_token=refresh-novo;'));

    for (const line of setCookie) {
      const attributes = attributesOf(line);
      for (const expected of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/api']) {
        assert.ok(attributes.includes(expected), `${expected} em ${line}`);
      }
      assert.ok(!attributes.some((attribute) => attribute.startsWith('Domain=')), 'sem Domain');
    }

    assert.ok(attributesOf(setCookie[0]).includes('Max-Age=3600'), 'access token: o expires_in do Supabase');
    assert.ok(attributesOf(setCookie[1]).includes('Max-Age=2592000'), 'refresh token: 30 dias');
    assert.equal(cacheControl, 'private, no-store');
  });

  test('apagar: mesmo nome e Path da gravação, valor vazio e validade no passado', async () => {
    const production = buildSessionCookieOptions({ production: true });

    const { setCookie, cacheControl } = await captureResponse((res) => clearSessionCookies(res, production));

    assert.equal(setCookie.length, 2);
    for (const [index, name] of ['tbott_access_token', 'tbott_refresh_token'].entries()) {
      assert.ok(setCookie[index].startsWith(`${name}=;`), setCookie[index]);
      const attributes = attributesOf(setCookie[index]);
      assert.ok(attributes.includes('Path=/api'));
      assert.ok(attributes.includes('Expires=Thu, 01 Jan 1970 00:00:00 GMT'));
      assert.ok(attributes.includes('HttpOnly') && attributes.includes('Secure'));
    }
    assert.equal(cacheControl, 'private, no-store');
  });

  test('leitura: pega os dois tokens do cabeçalho Cookie e ignora os outros cookies', () => {
    assert.deepEqual(
      readSessionCookies({ headers: { cookie: 'tema=escuro; tbott_access_token=a.b.c; tbott_refresh_token=r1' } }),
      { accessToken: 'a.b.c', refreshToken: 'r1' }
    );
    assert.deepEqual(readSessionCookies({ headers: {} }), { accessToken: null, refreshToken: null });
    assert.deepEqual(readSessionCookies({ headers: { cookie: 'tbott_access_token=' } }), { accessToken: null, refreshToken: null });
  });
});

describe('validação do login', () => {
  test('aceita dados válidos: e-mail normalizado e senha exatamente como digitada', () => {
    assert.deepEqual(loginSchema.parse({ email: '  JOGADOR@Example.COM ', password: '  Senha com espaços  ' }), {
      email: 'jogador@example.com',
      password: '  Senha com espaços  '
    });
  });

  test('aceita senhas curtas: contas criadas pelo painel do Supabase podem ter só 6 caracteres', () => {
    assert.equal(loginSchema.safeParse({ email: 'jogador@example.com', password: '123456' }).success, true);
  });

  test('campos ausentes, tipos errados, e-mail inválido e senha vazia ou longa demais', () => {
    assert.deepEqual(loginMessages({}), ['email: E-mail é obrigatório.', 'password: Senha é obrigatória.']);
    assert.deepEqual(loginMessages({ email: 1, password: null }), ['email: E-mail deve ser um texto.', 'password: Senha deve ser um texto.']);
    assert.deepEqual(loginMessages({ email: 'x', password: '' }), ['email: E-mail inválido.', 'password: Senha é obrigatória.']);
    assert.deepEqual(loginMessages({ email: 'jogador@example.com', password: 'a'.repeat(73) }), ['password: Senha deve ter no máximo 72 caracteres.']);
  });

  test('descarta campos extras e recusa corpo que não é um objeto JSON', () => {
    assert.deepEqual(Object.keys(loginSchema.parse({ email: 'jogador@example.com', password: PASSWORD, role: 'admin' })).sort(), ['email', 'password']);

    for (const body of [undefined, [], 'texto']) {
      assert.deepEqual(loginMessages(body), ['request: O corpo da requisição deve ser um objeto JSON.']);
    }
  });
});

describe('cliente do Supabase', () => {
  test('cada chamada cria um cliente novo: a sessão de um jogador nunca fica num cliente compartilhado', () => {
    const first = createSupabaseClient();
    const second = createSupabaseClient();

    assert.notEqual(first, second);
    assert.notEqual(first.auth, second.auth);
  });
});

describe('login no service', () => {
  test('sucesso: devolve a sessão separada de user e profile, com só os campos públicos', async () => {
    const supabase = fakeSupabase({ signInWithPassword: async () => ({ data: { user: { ...USER, app_metadata: {} }, session: SESSION }, error: null }) });
    const repo = { findProfileById: async (id) => ({ id, username: 'Jogador_1', created_at: '2026-10-25' }) };

    const result = await loginUser({ email: USER.email, password: PASSWORD }, { supabase, repo });

    assert.deepEqual(result, {
      session: SESSION,
      user: USER,
      profile: { id: USER.id, username: 'Jogador_1' }
    });
  });

  const cases = [
    ['credenciais inválidas', new AuthApiError('Invalid login credentials', 400, 'invalid_credentials'), 401, 'INVALID_CREDENTIALS'],
    ['e-mail não confirmado', new AuthApiError('Email not confirmed', 400, 'email_not_confirmed'), 403, 'EMAIL_NOT_CONFIRMED'],
    ['limite de tentativas', new AuthApiError('Request rate limit reached', 429, 'over_request_rate_limit'), 429, 'AUTH_RATE_LIMITED'],
    ['rede fora do ar', new AuthRetryableFetchError('fetch failed', 0), 503, 'SUPABASE_UNAVAILABLE'],
    ['Supabase respondendo 5xx', new AuthRetryableFetchError('Service Unavailable', 503), 503, 'SUPABASE_UNAVAILABLE'],
    ['resposta que não é JSON', new AuthUnknownError('Unexpected token <', null), 503, 'SUPABASE_UNAVAILABLE'],
    ['outro motivo (ex.: login por e-mail desligado no painel)', new AuthApiError('Email logins are disabled', 422, 'email_provider_disabled'), 400, 'AUTH_LOGIN_FAILED']
  ];

  for (const [name, supabaseError, statusCode, code] of cases) {
    test(`erro do Supabase, ${name}: ${statusCode} ${code}, sem procurar o perfil`, async () => {
      const supabase = fakeSupabase({ signInWithPassword: async () => failure(supabaseError) });
      let profileLookups = 0;
      const repo = { findProfileById: async () => { profileLookups += 1; } };

      await assert.rejects(loginUser({ email: USER.email, password: PASSWORD }, { supabase, repo }), isAppError(statusCode, code));
      assert.equal(profileLookups, 0);
    });
  }

  test('erro de programação não é disfarçado de 401 nem de 503', async () => {
    const bug = new TypeError('bug simulado');
    const supabase = fakeSupabase({
      signInWithPassword: async () => {
        throw bug;
      }
    });

    await assert.rejects(loginUser({ email: USER.email, password: PASSWORD }, { supabase }), (error) => error === bug);
  });
});

describe('sessão no service (resolveSession)', () => {
  test('access token aceito: devolve o jogador e não renova', async () => {
    const supabase = fakeSupabase({ getUser: async () => ({ data: { user: { ...USER, role: 'authenticated' } }, error: null }) });

    const result = await resolveSession({ accessToken: 'access-valido', refreshToken: 'refresh-valido' }, { supabase });

    assert.deepEqual(result, { user: USER, renewedSession: null });
    assert.deepEqual(supabase.calls.refreshSession, []);
  });

  test('duas renovações simultâneas com o mesmo refresh token: uma chamada ao Supabase e a mesma sessão para as duas', async () => {
    // As renovações ficam pendentes até o teste respondê-las, para as duas requisições se cruzarem.
    const pending = [];
    const finishAll = () => pending.splice(0).forEach((finish) => finish(renewed()));
    const supabase = fakeSupabase({
      refreshSession: () => new Promise((resolve) => {
        pending.push(resolve);
      })
    });

    const first = resolveSession({ refreshToken: 'refresh-compartilhado' }, { supabase });
    const second = resolveSession({ refreshToken: 'refresh-compartilhado' }, { supabase });
    finishAll();
    const results = await Promise.all([first, second]);

    assert.deepEqual(supabase.calls.refreshSession, ['refresh-compartilhado']);
    assert.equal(results[0].renewedSession, SESSION);
    assert.equal(results[1].renewedSession, SESSION);

    // Terminada a renovação, a entrada sai da lista: um pedido posterior chama o Supabase de novo.
    const later = resolveSession({ refreshToken: 'refresh-compartilhado' }, { supabase });
    finishAll();
    await later;
    assert.equal(supabase.calls.refreshSession.length, 2);
  });

  test('refresh tokens diferentes (jogadores diferentes) não dividem a renovação', async () => {
    const supabase = fakeSupabase({
      refreshSession: ({ refresh_token: token }) => renewed({ ...SESSION, refresh_token: `${token}-novo`, user: { id: token, email: USER.email } })
    });

    const [ana, bia] = await Promise.all([
      resolveSession({ refreshToken: 'ana' }, { supabase }),
      resolveSession({ refreshToken: 'bia' }, { supabase })
    ]);

    assert.deepEqual(supabase.calls.refreshSession.sort(), ['ana', 'bia']);
    assert.equal(ana.user.id, 'ana');
    assert.equal(bia.user.id, 'bia');
    assert.equal(ana.renewedSession.refresh_token, 'ana-novo');
    assert.equal(bia.renewedSession.refresh_token, 'bia-novo');
  });

  test('access token recusado (sessão encerrada) e refresh recusado: 401 AUTH_SESSION_EXPIRED', async () => {
    const supabase = fakeSupabase({
      getUser: async () => failure(new AuthSessionMissingError()),
      refreshSession: () => failure(new AuthApiError('Invalid Refresh Token: Already Used', 400, 'refresh_token_already_used'))
    });

    await assert.rejects(
      resolveSession({ accessToken: 'access-encerrado', refreshToken: 'refresh-usado' }, { supabase }),
      isAppError(401, 'AUTH_SESSION_EXPIRED')
    );
    assert.deepEqual(supabase.calls.refreshSession, ['refresh-usado']);
  });

  test('access token recusado e nenhum refresh token: 401 sem tentar renovar', async () => {
    const supabase = fakeSupabase({ getUser: async () => failure(new AuthApiError('invalid JWT', 403, 'bad_jwt')) });

    await assert.rejects(resolveSession({ accessToken: 'access-vencido' }, { supabase }), isAppError(401, 'AUTH_SESSION_EXPIRED'));
    assert.deepEqual(supabase.calls.refreshSession, []);
  });

  test('Supabase fora do ar ao conferir o access token: 503, sem renovar e sem dar a sessão como inválida', async () => {
    const supabase = fakeSupabase({ getUser: async () => failure(new AuthRetryableFetchError('fetch failed', 0)) });

    await assert.rejects(
      resolveSession({ accessToken: 'access-valido', refreshToken: 'refresh-valido' }, { supabase }),
      isAppError(503, 'SUPABASE_UNAVAILABLE')
    );
    assert.deepEqual(supabase.calls.refreshSession, []);
  });

  test('falha de rede durante a renovação: 503 (não 401), então os cookies não são apagados', async () => {
    const supabase = fakeSupabase({ refreshSession: () => failure(new AuthRetryableFetchError('fetch failed', 0)) });

    await assert.rejects(resolveSession({ refreshToken: 'refresh-valido' }, { supabase }), isAppError(503, 'SUPABASE_UNAVAILABLE'));
  });

  test('limite de renovações do Supabase: 429 AUTH_RATE_LIMITED', async () => {
    const supabase = fakeSupabase({ refreshSession: () => failure(new AuthApiError('Request rate limit reached', 429, 'over_request_rate_limit')) });

    await assert.rejects(resolveSession({ refreshToken: 'refresh-valido' }, { supabase }), isAppError(429, 'AUTH_RATE_LIMITED'));
  });

  test('erro de programação não é disfarçado de 401 nem de 503', async () => {
    const bug = new TypeError('bug simulado');
    const supabase = fakeSupabase({
      getUser: async () => {
        throw bug;
      }
    });

    await assert.rejects(resolveSession({ accessToken: 'access-valido' }, { supabase }), (error) => error === bug);
  });
});

describe('logout no service', () => {
  test('sem tokens: nada a encerrar e nenhum cliente do Supabase criado', async () => {
    const context = {
      get supabase() {
        throw new Error('o logout sem cookies não deveria usar o Supabase');
      }
    };

    assert.deepEqual(await logoutUser({}, context), { revoked: false });
  });

  test('access token válido: encerra só esta sessão (scope local), sem renovar', async () => {
    const supabase = fakeSupabase({ signOut: async () => ({ data: null, error: null }) });

    assert.deepEqual(await logoutUser({ accessToken: 'access-valido', refreshToken: 'refresh-valido' }, { supabase }), { revoked: true });
    assert.deepEqual(supabase.calls.signOut, ['local']);
    assert.deepEqual(supabase.calls.refreshSession, []);
  });

  test('Supabase fora do ar: não lança erro e nem tenta renovar', async () => {
    const supabase = fakeSupabase({ signOut: async () => ({ data: null, error: new AuthRetryableFetchError('fetch failed', 0) }) });

    assert.deepEqual(await logoutUser({ accessToken: 'access-valido', refreshToken: 'refresh-valido' }, { supabase }), { revoked: false });
    assert.deepEqual(supabase.calls.refreshSession, []);
    assert.ok(logLines.some((line) => line.includes('[auth:logout] stage=revoke_failed errorCode=AuthRetryableFetchError')));
  });

  test('access token vencido: renova e encerra a sessão com o token novo', async () => {
    const supabase = fakeSupabase({
      signOut: async (jwt) => (jwt === 'access-novo'
        ? { data: null, error: null }
        : { data: null, error: new AuthApiError('invalid JWT', 403, 'bad_jwt') }),
      refreshSession: () => renewed()
    });

    assert.deepEqual(await logoutUser({ accessToken: 'access-vencido', refreshToken: 'refresh-valido' }, { supabase }), { revoked: true });
    assert.deepEqual(supabase.calls.signOut, ['local', 'local']);
  });

  test('sessão já encerrada (renovação recusada): não lança erro', async () => {
    const supabase = fakeSupabase({
      refreshSession: () => failure(new AuthApiError('Invalid Refresh Token: Refresh Token Not Found', 400, 'refresh_token_not_found'))
    });

    assert.deepEqual(await logoutUser({ refreshToken: 'refresh-encerrado' }, { supabase }), { revoked: false });
    assert.deepEqual(supabase.calls.signOut, []);
  });
});

describe('verificação de Origin (CSRF)', () => {
  const check = createOriginCheck(['http://localhost:5173']);

  // Executa o middleware e devolve o erro passado ao next (ou null se a requisição seguiu).
  const run = ({ method = 'POST', origin, host = 'localhost:8000' }) => {
    let result;
    const req = { method, get: (name) => ({ origin, host })[name.toLowerCase()] };
    check(req, {}, (error) => {
      result = error ?? null;
    });
    return result;
  };

  test('deixa passar: leituras (GET), o TBOTT_web, a própria API (Swagger) e clientes sem Origin', () => {
    assert.equal(run({ method: 'GET', origin: 'http://site-malicioso.example' }), null);
    assert.equal(run({ origin: 'http://localhost:5173' }), null);
    assert.equal(run({ origin: 'http://localhost:8000' }), null);
    assert.equal(run({ origin: undefined }), null);
  });

  test('recusa com 403 outras origens, "null" e imitações do endereço do front-end', () => {
    for (const origin of ['http://site-malicioso.example', 'null', 'http://localhost:5173.site-malicioso.example', 'https://localhost:5173']) {
      assert.ok(isAppError(403, 'ORIGIN_NOT_ALLOWED')(run({ origin })), origin);
    }
  });
});
