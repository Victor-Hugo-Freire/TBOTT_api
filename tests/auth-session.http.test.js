import './helpers/fakeEnv.js';

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import { inspect } from 'node:util';

import app from '../src/app.js';
import { closeDatabasePool } from '../src/config/database.js';
import config from '../src/config/index.js';
import { createSwaggerSpec } from '../src/docs/catalog.js';
import { findProfileById } from '../src/repository/profileRepository.js';
import { startFakeAuthServer } from './helpers/fakeAuthServer.js';
import { createAuthUser, createTestDatabase } from './helpers/testDatabase.js';

// Testes HTTP de login, sessão e logout: app, CORS, CSRF, middleware, controllers, service e
// repositório reais. O Supabase Auth é o simulado na rede (helpers/fakeAuthServer.js), acessado
// pelo cliente supabase-js de verdade; o banco é o PostgreSQL em memória, com o gatilho que cria
// os perfis.

const PASSWORD = 'Senha-Teste-123';
const WRONG_PASSWORD = 'Senha-Errada-987';
const FRONTEND = 'http://localhost:5173';
const EVIL = 'http://site-malicioso.example';
const GENERIC_ERROR = 'Não foi possível concluir a operação no momento.';
const THIRTY_DAYS_IN_SECONDS = String(30 * 24 * 60 * 60);
const REFRESH = 'POST /auth/v1/token?grant_type=refresh_token';
const LOGOUT = 'POST /auth/v1/logout';

let pglite;
let db;
let server;
let baseUrl;
let authServer;
let logLines = [];
let accountCount = 0;

before(async () => {
  ({ pglite, db } = await createTestDatabase());
  authServer = await startFakeAuthServer();

  // O cliente do Supabase é criado a cada requisição e lê SUPABASE_URL na hora: daqui em diante,
  // a API conversa com o Auth simulado em 127.0.0.1, nunca com o Supabase real.
  process.env.SUPABASE_URL = authServer.url;

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  // Se algum teste falhou no meio de uma requisição, derruba a conexão em vez de esperar por ela.
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await authServer.close();
  await closeDatabasePool();
  await pglite.close();
});

beforeEach(() => {
  logLines = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    mock.method(console, level, (...args) => {
      logLines.push(args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { depth: 5 }))).join(' '));
    });
  }

  // Perfis no banco em memória. O Supabase é o cliente real, apontando para o Auth simulado.
  app.locals.authContext = { repo: { findProfileById: (id) => findProfileById(id, db) } };
});

// Em todos os cenários: nenhuma senha, e-mail ou token nos logs.
afterEach(() => {
  mock.restoreAll();
  delete app.locals.authContext;

  for (const line of logLines) {
    assert.ok(!line.includes(PASSWORD) && !line.includes(WRONG_PASSWORD), `senha no log: ${line}`);
    assert.ok(!line.includes('@example.com'), `e-mail no log: ${line}`);

    for (const token of authServer.issuedTokens) {
      assert.ok(!line.includes(token), `token no log: ${line}`);
    }
  }
});

// Conta completa: auth.users + perfil (criado pelo gatilho) no banco e a senha no Auth simulado.
const createAccount = async ({ confirmed = true } = {}) => {
  accountCount += 1;
  const email = `jogador${accountCount}@example.com`;
  const username = `Jogador_${accountCount}`;
  const id = await createAuthUser(db, { email, username });

  authServer.addAccount({ id, email, password: PASSWORD, confirmed });
  return { id, email, username };
};

// Cada Set-Cookie vira [nome, { value, attributes }], para os testes conferirem atributo a atributo.
const parseSetCookie = (line) => {
  const [pair, ...parts] = line.split(';').map((part) => part.trim());
  const separator = pair.indexOf('=');
  const attributes = {};

  for (const part of parts) {
    const [key, ...value] = part.split('=');
    attributes[key.toLowerCase()] = value.length ? value.join('=') : true;
  }

  return [pair.slice(0, separator), { value: pair.slice(separator + 1), attributes }];
};

const call = async (method, path, { body, raw, contentType = 'application/json', cookies, origin } = {}) => {
  const hasBody = body !== undefined || raw !== undefined;
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(hasBody ? { 'content-type': contentType } : {}),
      ...(cookies ? { cookie: cookies } : {}),
      ...(origin ? { origin } : {})
    },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body))
  });
  const text = await response.text();

  return {
    status: response.status,
    headers: response.headers,
    text,
    body: text ? JSON.parse(text) : null,
    cookies: Object.fromEntries(response.headers.getSetCookie().map(parseSetCookie))
  };
};

// Chamadas como o navegador do TBOTT_web faria: com o Origin do front-end.
const login = (email, password = PASSWORD) => call('POST', '/api/auth/login', { body: { email, password }, origin: FRONTEND });
const me = (cookies) => call('GET', '/api/auth/me', { cookies, origin: FRONTEND });
const logout = (cookies) => call('POST', '/api/auth/logout', { cookies, origin: FRONTEND });

// Os tokens que o navegador guardou, no formato do cabeçalho Cookie.
const cookieHeader = ({ access, refresh }) => [
  access && `tbott_access_token=${access}`,
  refresh && `tbott_refresh_token=${refresh}`
].filter(Boolean).join('; ');

const sessionFrom = (response) => ({
  access: response.cookies.tbott_access_token?.value,
  refresh: response.cookies.tbott_refresh_token?.value
});

const loginAs = async (account) => {
  const response = await login(account.email);
  assert.equal(response.status, 200, response.text);
  return sessionFrom(response);
};

const assertCookiesCleared = (response) => {
  for (const name of ['tbott_access_token', 'tbott_refresh_token']) {
    const cookie = response.cookies[name];

    assert.ok(cookie, `${name} deveria ser apagado`);
    assert.equal(cookie.value, '');
    assert.equal(cookie.attributes.path, '/api', 'mesmo Path da gravação, senão o navegador não apaga');
    assert.equal(cookie.attributes.httponly, true);
    assert.ok(new Date(cookie.attributes.expires) < new Date(), 'validade no passado');
  }
};

describe('POST /api/auth/login', () => {
  test('login válido: 200 só com user e profile; os tokens vão em cookies httpOnly', async () => {
    const account = await createAccount();

    const response = await login(account.email);

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      user: { id: account.id, email: account.email },
      profile: { id: account.id, username: account.username }
    });
    assert.equal(response.headers.get('cache-control'), 'private, no-store');

    const { tbott_access_token: access, tbott_refresh_token: refresh } = response.cookies;
    assert.ok(authServer.issuedTokens.has(access.value), 'o cookie guarda o access token emitido pelo Supabase');
    assert.ok(authServer.issuedTokens.has(refresh.value), 'o cookie guarda o refresh token emitido pelo Supabase');

    for (const cookie of [access, refresh]) {
      assert.equal(cookie.attributes.httponly, true);
      assert.equal(cookie.attributes.samesite, 'Lax');
      assert.equal(cookie.attributes.path, '/api');
      assert.equal(cookie.attributes.secure, undefined, 'fora de produção, sem Secure');
      assert.equal(cookie.attributes.domain, undefined, 'sem Domain: o cookie fica preso ao endereço da API');
    }
    assert.equal(access.attributes['max-age'], '3600', 'o access token dura o expires_in informado pelo Supabase');
    assert.equal(refresh.attributes['max-age'], THIRTY_DAYS_IN_SECONDS);

    assert.doesNotMatch(response.text, /token/i, 'nenhum token no corpo');
  });

  test('senha errada e e-mail sem conta: o mesmo 401 INVALID_CREDENTIALS, sem cookies', async () => {
    const account = await createAccount();

    const responses = [await login(account.email, WRONG_PASSWORD), await login('ninguem@example.com')];

    for (const response of responses) {
      assert.equal(response.status, 401);
      assert.deepEqual(response.body, { error: 'E-mail ou senha incorretos.', code: 'INVALID_CREDENTIALS' });
      assert.deepEqual(response.cookies, {});
    }
  });

  test('e-mail ainda não confirmado: 403 EMAIL_NOT_CONFIRMED com a senha certa; com a errada, 401', async () => {
    const account = await createAccount({ confirmed: false });

    const response = await login(account.email);

    assert.equal(response.status, 403);
    assert.deepEqual(response.body, {
      error: 'Confirme seu e-mail antes de entrar. Use o link enviado no cadastro.',
      code: 'EMAIL_NOT_CONFIRMED'
    });
    assert.deepEqual(response.cookies, {});
    assert.equal((await login(account.email, WRONG_PASSWORD)).body.code, 'INVALID_CREDENTIALS');
  });

  test('dados inválidos ou JSON malformado: 400, sem chamar o Supabase', async () => {
    const callsBefore = authServer.requests.length;

    const missing = await call('POST', '/api/auth/login', { body: {}, origin: FRONTEND });
    assert.equal(missing.status, 400);
    assert.deepEqual(missing.body, {
      error: 'Dados de login inválidos.',
      code: 'INVALID_LOGIN_DATA',
      details: [
        { field: 'email', message: 'E-mail é obrigatório.' },
        { field: 'password', message: 'Senha é obrigatória.' }
      ]
    });

    const invalid = await call('POST', '/api/auth/login', { body: { email: 'nao-e-email', password: '' }, origin: FRONTEND });
    assert.deepEqual(invalid.body.details, [
      { field: 'email', message: 'E-mail inválido.' },
      { field: 'password', message: 'Senha é obrigatória.' }
    ]);

    const wrongTypes = await call('POST', '/api/auth/login', { body: { email: 123, password: true }, origin: FRONTEND });
    assert.deepEqual(wrongTypes.body.details, [
      { field: 'email', message: 'E-mail deve ser um texto.' },
      { field: 'password', message: 'Senha deve ser um texto.' }
    ]);

    const broken = await call('POST', '/api/auth/login', { raw: `{"email":"a@example.com","password":${PASSWORD}`, origin: FRONTEND });
    assert.equal(broken.status, 400);
    assert.deepEqual(broken.body, { error: 'O corpo da requisição não é um JSON válido.', code: 'INVALID_JSON' });
    assert.ok(!broken.text.includes('Senha-Te'), 'a resposta não repete a senha');

    assert.equal(authServer.requests.length, callsBefore);
  });

  test('e-mail com maiúsculas e espaços entra na mesma conta (mesma regra do cadastro)', async () => {
    const account = await createAccount();

    const response = await login(`  ${account.email.toUpperCase()}  `);

    assert.equal(response.status, 200);
    assert.equal(response.body.user.id, account.id);
  });

  test('Supabase fora do ar: 503 SUPABASE_UNAVAILABLE com mensagem genérica, sem cookies', async () => {
    const account = await createAccount();
    authServer.failNext(503);

    const response = await login(account.email);

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { error: GENERIC_ERROR, code: 'SUPABASE_UNAVAILABLE' });
    assert.deepEqual(response.cookies, {});
  });

  test('conta sem perfil: 500 PROFILE_NOT_FOUND, sem cookies, e a sessão criada é encerrada', async () => {
    // A conta existe no Auth simulado, mas não no banco: nenhum gatilho criou o perfil.
    const id = randomUUID();
    authServer.addAccount({ id, email: 'sem.perfil@example.com', password: PASSWORD });

    const response = await login('sem.perfil@example.com');

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { error: GENERIC_ERROR, code: 'PROFILE_NOT_FOUND' });
    assert.deepEqual(response.cookies, {});
    assert.equal(authServer.activeSessionsOf(id), 0, 'nenhuma sessão ficou aberta no Supabase');
    assert.ok(logLines.some((line) => line.includes('PROFILE_NOT_FOUND') && line.includes('migração 0001')));
  });

  test('banco indisponível depois do login: 503 PROFILE_QUERY_FAILED, sem cookies e sessão encerrada', async () => {
    const account = await createAccount();
    // Sem repo: usa o PostgreSQL de verdade, que o fakeEnv aponta para uma porta fechada.
    app.locals.authContext = {};

    const response = await login(account.email);

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { error: GENERIC_ERROR, code: 'PROFILE_QUERY_FAILED' });
    assert.deepEqual(response.cookies, {});
    assert.equal(authServer.activeSessionsOf(account.id), 0);
  });
});

describe('GET /api/auth/me e renovação da sessão', () => {
  test('sem cookies: 401 AUTH_SESSION_MISSING, sem chamar o Supabase', async () => {
    const callsBefore = authServer.requests.length;

    const response = await me();

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: 'Faça login para continuar.', code: 'AUTH_SESSION_MISSING' });
    assert.deepEqual(response.cookies, {});
    assert.equal(authServer.requests.length, callsBefore);
  });

  test('com a sessão do login: 200 com o usuário e o perfil corretos, sem renovar', async () => {
    const account = await createAccount();
    const session = await loginAs(account);

    const response = await me(cookieHeader(session));

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      user: { id: account.id, email: account.email },
      profile: { id: account.id, username: account.username }
    });
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.deepEqual(response.cookies, {}, 'sem renovação, nenhum cookie novo');
  });

  test('access token inválido e nenhum refresh token: 401 AUTH_SESSION_EXPIRED e cookies apagados', async () => {
    const response = await me(cookieHeader({ access: 'token-adulterado' }));

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { error: 'Sua sessão expirou. Faça login novamente.', code: 'AUTH_SESSION_EXPIRED' });
    assertCookiesCleared(response);
  });

  test('access token vencido e refresh válido: 200 e cookies novos na mesma resposta', async () => {
    const account = await createAccount();
    const session = await loginAs(account);
    authServer.expireAccessTokens();
    const refreshesBefore = authServer.countRequests(REFRESH);

    const response = await me(cookieHeader(session));

    assert.equal(response.status, 200);
    assert.equal(response.body.user.id, account.id);
    assert.equal(authServer.countRequests(REFRESH), refreshesBefore + 1);

    const renewed = sessionFrom(response);
    assert.ok(renewed.access && renewed.access !== session.access, 'access token novo');
    assert.ok(renewed.refresh && renewed.refresh !== session.refresh, 'o refresh token é trocado a cada renovação');
    assert.equal(response.cookies.tbott_access_token.attributes.httponly, true);
    assert.equal(response.cookies.tbott_refresh_token.attributes['max-age'], THIRTY_DAYS_IN_SECONDS, 'o prazo de 30 dias recomeça');

    const next = await me(cookieHeader(renewed));
    assert.equal(next.status, 200);
    assert.deepEqual(next.cookies, {}, 'os cookies novos funcionam sem outra renovação');
  });

  test('só o refresh token (o navegador já apagou o cookie do access token vencido): renova e responde 200', async () => {
    const account = await createAccount();
    const session = await loginAs(account);

    const response = await me(cookieHeader({ refresh: session.refresh }));

    assert.equal(response.status, 200);
    assert.equal(response.body.user.id, account.id);
    assert.ok(sessionFrom(response).access, 'grava um access token novo');
  });

  test('refresh token inválido: 401 AUTH_SESSION_EXPIRED e os dois cookies apagados', async () => {
    const response = await me(cookieHeader({ refresh: 'refresh-inexistente' }));

    assert.equal(response.status, 401);
    assert.equal(response.body.code, 'AUTH_SESSION_EXPIRED');
    assertCookiesCleared(response);
  });

  test('refresh token antigo reaproveitado (cookie copiado): o Supabase encerra a sessão e a API responde 401', async () => {
    const account = await createAccount();
    const first = await loginAs(account);
    authServer.expireAccessTokens();
    const second = sessionFrom(await me(cookieHeader(first)));
    authServer.expireAccessTokens();
    const third = sessionFrom(await me(cookieHeader(second)));

    const stale = await me(cookieHeader({ refresh: first.refresh }));

    assert.equal(stale.status, 401);
    assertCookiesCleared(stale);
    assert.equal((await me(cookieHeader(third))).status, 401, 'a sessão inteira foi encerrada');
  });

  test('sessão encerrada no Supabase (logout em outra aba): 401 na hora, mesmo com o access token no prazo', async () => {
    const account = await createAccount();
    const session = await loginAs(account);
    assert.equal((await logout(cookieHeader(session))).status, 200);

    const response = await me(cookieHeader(session));

    assert.equal(response.status, 401);
    assert.equal(response.body.code, 'AUTH_SESSION_EXPIRED');
    assertCookiesCleared(response);
  });

  test('Supabase fora do ar ao conferir a sessão: 503 e os cookies continuam', async () => {
    const account = await createAccount();
    const session = await loginAs(account);
    authServer.failNext(503);

    const response = await me(cookieHeader(session));

    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { error: GENERIC_ERROR, code: 'SUPABASE_UNAVAILABLE' });
    assert.deepEqual(response.cookies, {}, 'nenhum cookie apagado');
    assert.equal((await me(cookieHeader(session))).status, 200, 'quando o Supabase volta, a mesma sessão funciona');
  });

  test('sessão válida, mas o perfil sumiu do banco: 500 PROFILE_NOT_FOUND, sem inventar nome e sem apagar os cookies', async () => {
    const account = await createAccount();
    const session = await loginAs(account);
    await db.query('delete from public.profiles where id = $1', [account.id]);

    const response = await me(cookieHeader(session));

    assert.equal(response.status, 500);
    assert.deepEqual(response.body, { error: GENERIC_ERROR, code: 'PROFILE_NOT_FOUND' });
    assert.deepEqual(response.cookies, {});
  });

  test('jogadores diferentes renovando ao mesmo tempo: cada um recebe a própria sessão', { timeout: 10000 }, async () => {
    const ana = await createAccount();
    const bia = await createAccount();
    const anaSession = await loginAs(ana);
    const biaSession = await loginAs(bia);
    authServer.expireAccessTokens();

    // O Auth simulado só responde quando as DUAS renovações chegaram, então elas acontecem juntas
    // de verdade. Com um cliente do Supabase compartilhado, a segunda nem chegaria ao servidor:
    // a biblioteca entregaria a ela a renovação da primeira, isto é, a sessão da Ana.
    const bothArrived = authServer.holdRefreshesUntil(2);
    const [anaResponse, biaResponse] = await Promise.all([me(cookieHeader(anaSession)), me(cookieHeader(biaSession))]);

    assert.equal(await bothArrived, true, 'cada requisição deveria fazer a própria renovação no Supabase');
    assert.equal(anaResponse.status, 200);
    assert.equal(biaResponse.status, 200);
    assert.equal(anaResponse.body.user.id, ana.id);
    assert.equal(biaResponse.body.user.id, bia.id);

    // Os cookies novos de cada uma continuam sendo dela.
    assert.equal((await me(cookieHeader(sessionFrom(anaResponse)))).body.user.id, ana.id);
    assert.equal((await me(cookieHeader(sessionFrom(biaResponse)))).body.user.id, bia.id);
  });

  test('duas requisições do mesmo jogador com o token vencido: as duas funcionam e terminam com o mesmo refresh token', async () => {
    const account = await createAccount();
    const session = await loginAs(account);
    authServer.expireAccessTokens();

    const responses = await Promise.all([me(cookieHeader(session)), me(cookieHeader(session))]);

    assert.deepEqual(responses.map((response) => response.status), [200, 200]);
    const [first, second] = responses.map(sessionFrom);
    assert.equal(first.refresh, second.refresh, 'seja qual for a resposta que chegar por último, o cookie final vale');
    assert.equal((await me(cookieHeader(second))).status, 200);
  });
});

describe('POST /api/auth/logout', () => {
  test('sessão válida: 200, encerra só a sessão deste aparelho e apaga os cookies', async () => {
    const account = await createAccount();
    const computer = await loginAs(account);
    const phone = await loginAs(account);

    const response = await logout(cookieHeader(computer));

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'logged_out' });
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assertCookiesCleared(response);

    const logoutCall = authServer.requests.findLast((request) => request.endpoint === LOGOUT);
    assert.equal(logoutCall.scope, 'local', 'não derruba os outros aparelhos');
    assert.equal(logoutCall.bearer, true, 'usa o token do próprio jogador');
    assert.equal(logoutCall.apikey, 'sb_publishable_teste', 'com a chave pública, nunca uma chave secreta');

    assert.equal((await me(cookieHeader(computer))).status, 401, 'a sessão encerrada não vale mais');
    assert.equal((await me(cookieHeader(phone))).status, 200, 'o outro aparelho continua logado');
  });

  test('sem cookies: 200, cookies apagados e nenhuma chamada ao Supabase', async () => {
    const callsBefore = authServer.requests.length;

    const response = await logout();

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'logged_out' });
    assertCookiesCleared(response);
    assert.equal(authServer.requests.length, callsBefore);
  });

  test('access token vencido: renova só para encerrar a sessão, e o refresh token deixa de valer', async () => {
    const account = await createAccount();
    const session = await loginAs(account);
    authServer.expireAccessTokens();

    const response = await logout(cookieHeader(session));

    assert.equal(response.status, 200);
    assertCookiesCleared(response);
    assert.equal(authServer.activeSessionsOf(account.id), 0, 'a sessão foi encerrada no Supabase');
    assert.equal((await me(cookieHeader({ refresh: session.refresh }))).status, 401);
  });

  test('só com o refresh token (o cookie do access token já expirou no navegador): encerra a sessão', async () => {
    const account = await createAccount();
    const session = await loginAs(account);

    const response = await logout(cookieHeader({ refresh: session.refresh }));

    assert.equal(response.status, 200);
    assert.equal(authServer.activeSessionsOf(account.id), 0);
  });

  test('sessão já inválida: 200 e cookies apagados', async () => {
    const response = await logout(cookieHeader({ access: 'token-adulterado', refresh: 'refresh-inexistente' }));

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { status: 'logged_out' });
    assertCookiesCleared(response);
  });

  test('Supabase fora do ar: 200 e cookies apagados mesmo assim; a falha fica só no log', async () => {
    const account = await createAccount();
    const session = await loginAs(account);
    authServer.failNext(503);

    const response = await logout(cookieHeader(session));

    assert.equal(response.status, 200);
    assertCookiesCleared(response);
    assert.ok(logLines.some((line) => line.includes('[auth:logout] stage=revoke_failed')));
  });
});

describe('CORS', () => {
  test('preflight do TBOTT_web: libera a origem exata, com credenciais', async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'OPTIONS',
      headers: {
        origin: FRONTEND,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type'
      }
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), FRONTEND);
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    assert.match(response.headers.get('access-control-allow-methods'), /POST/);
    assert.match(response.headers.get('vary'), /Origin/);
  });

  test('preflight de outro site: sem Access-Control-Allow-Origin, então o navegador não envia a requisição', async () => {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'OPTIONS',
      headers: { origin: EVIL, 'access-control-request-method': 'POST' }
    });

    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });

  test('respostas a outro site não liberam a leitura (e nunca usam "*")', async () => {
    const account = await createAccount();
    const session = await loginAs(account);

    const fromEvil = await call('GET', '/api/auth/me', { cookies: cookieHeader(session), origin: EVIL });
    const fromFrontend = await me(cookieHeader(session));

    assert.equal(fromEvil.headers.get('access-control-allow-origin'), null);
    assert.equal(fromFrontend.headers.get('access-control-allow-origin'), FRONTEND);
    assert.equal(fromFrontend.headers.get('access-control-allow-credentials'), 'true');
  });
});

describe('CSRF: verificação do cabeçalho Origin', () => {
  test('formulário de outro site tentando fazer logout: 403 ORIGIN_NOT_ALLOWED e a sessão continua', async () => {
    const account = await createAccount();
    const session = await loginAs(account);
    const logoutsBefore = authServer.countRequests(LOGOUT);

    // Um <form method="post"> não pede permissão (preflight) ao navegador: a requisição chega.
    const response = await call('POST', '/api/auth/logout', {
      raw: 'qualquer=coisa',
      contentType: 'application/x-www-form-urlencoded',
      cookies: cookieHeader(session),
      origin: EVIL
    });

    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: 'Origem não autorizada para esta operação.', code: 'ORIGIN_NOT_ALLOWED' });
    assert.deepEqual(response.cookies, {});
    assert.equal(authServer.countRequests(LOGOUT), logoutsBefore);
    assert.equal((await me(cookieHeader(session))).status, 200);
  });

  test('login e cadastro disparados por outro site: 403 sem chamar o Supabase', async () => {
    const account = await createAccount();
    const callsBefore = authServer.requests.length;

    const loginResponse = await call('POST', '/api/auth/login', { body: { email: account.email, password: PASSWORD }, origin: EVIL });
    const registerResponse = await call('POST', '/api/auth/register', {
      body: { username: 'Outro_Site', email: 'outro.site@example.com', password: PASSWORD },
      origin: EVIL
    });

    assert.equal(loginResponse.status, 403);
    assert.equal(registerResponse.status, 403);
    assert.equal(authServer.requests.length, callsBefore);
  });

  test('Origin "null" (página em sandbox ou arquivo aberto no navegador): 403', async () => {
    const response = await call('POST', '/api/auth/logout', { origin: 'null' });

    assert.equal(response.status, 403);
  });

  test('Swagger (mesma origem da API) e clientes sem Origin (curl, PowerShell) continuam funcionando', async () => {
    const account = await createAccount();

    const viaSwagger = await call('POST', '/api/auth/login', { body: { email: account.email, password: PASSWORD }, origin: baseUrl });
    const viaTerminal = await call('POST', '/api/auth/login', { body: { email: account.email, password: PASSWORD } });

    assert.equal(viaSwagger.status, 200);
    assert.equal(viaTerminal.status, 200);
  });
});

describe('documentação', () => {
  test('o Swagger documenta login, /me e logout com os códigos que as rotas devolvem', () => {
    const { paths } = createSwaggerSpec(config);
    const loginDoc = paths['/api/auth/login'].post;

    assert.deepEqual(Object.keys(loginDoc.responses).sort(), ['200', '400', '401', '403', '429', '500', '503']);
    assert.deepEqual(Object.keys(paths['/api/auth/me'].get.responses).sort(), ['200', '401', '429', '500', '503']);
    assert.deepEqual(Object.keys(paths['/api/auth/logout'].post.responses).sort(), ['200', '403', '500', '503']);
    assert.deepEqual(loginDoc.requestBody.content['application/json'].schema.required, ['email', 'password']);
    assert.ok(loginDoc.responses[200].headers['Set-Cookie'], 'documenta os cookies do login');
    assert.doesNotMatch(JSON.stringify(loginDoc.responses[200].content), /access_token|refresh_token/);
  });

  test('o catálogo /api/routes mostra que /api/auth/me exige sessão e que o ranking continua público', async () => {
    const { routes } = await (await fetch(`${baseUrl}/api/routes`)).json();
    const authOf = (path) => routes.find((route) => route.path === path).auth;

    assert.match(authOf('/api/auth/me'), /Sessão/);
    assert.equal(authOf('/api/ranking'), 'Pública');
    assert.equal(authOf('/api/characters'), 'Pública');
  });

  test('rotas públicas continuam sem exigir login', async () => {
    const response = await call('GET', '/api/ranking?limit=0', { origin: FRONTEND });

    // 400 da validação do ranking (e não 401): a rota não passa pelo requireAuth.
    assert.equal(response.status, 400);
  });
});
