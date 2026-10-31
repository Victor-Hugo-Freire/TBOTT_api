import './helpers/fakeEnv.js';

import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';

import app from '../src/app.js';
import { closeDatabasePool } from '../src/config/database.js';
import { findProfileById } from '../src/repository/profileRepository.js';
import { insertRun } from '../src/repository/runRepository.js';
import { startFakeAuthServer } from './helpers/fakeAuthServer.js';
import { createAuthUser, createTestDatabase } from './helpers/testDatabase.js';

// Testes HTTP de POST /api/runs: app, CSRF, requireAuth, controller, service e repositório reais.
// O Supabase Auth é o simulado e o banco é o PostgreSQL em memória.

const PASSWORD = 'Senha-Teste-123';
const FRONTEND = 'http://localhost:5173';
const EVIL = 'http://site-malicioso.example';
const body = { characterId: 'tung-tung-sahur', durationMs: 650000, status: 'victory' };

let pglite;
let db;
let server;
let baseUrl;
let authServer;
let account;

before(async () => {
  ({ pglite, db } = await createTestDatabase());
  authServer = await startFakeAuthServer();
  process.env.SUPABASE_URL = authServer.url;

  const email = 'ana@example.com';
  const id = await createAuthUser(db, { email, username: 'Ana' });
  authServer.addAccount({ id, email, password: PASSWORD, confirmed: true });
  account = { id, email };

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await authServer.close();
  await closeDatabasePool();
  await pglite.close();
});

beforeEach(() => {
  app.locals.authContext = { repo: { findProfileById: (id) => findProfileById(id, db) } };
  app.locals.runContext = { repo: { insertRun: (data) => insertRun(data, db) } };
});

afterEach(() => {
  delete app.locals.authContext;
  delete app.locals.runContext;
});

const postRun = (payload, { cookies, origin = FRONTEND } = {}) => fetch(`${baseUrl}/api/runs`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(cookies ? { cookie: cookies } : {}),
    ...(origin ? { origin } : {})
  },
  body: JSON.stringify(payload)
});

const loginCookies = async () => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: FRONTEND },
    body: JSON.stringify({ email: account.email, password: PASSWORD })
  });
  assert.equal(response.status, 200);

  return response.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ');
};

describe('POST /api/runs', () => {
  test('sem sessão: 401 AUTH_SESSION_MISSING', async () => {
    const response = await postRun(body);

    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'AUTH_SESSION_MISSING');
  });

  test('Origin de outro site: 403 ORIGIN_NOT_ALLOWED', async () => {
    const response = await postRun(body, { cookies: await loginCookies(), origin: EVIL });

    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'ORIGIN_NOT_ALLOWED');
  });

  test('corpo inválido: 400 INVALID_RUN_DATA com details', async () => {
    const response = await postRun({ ...body, durationMs: 0 }, { cookies: await loginCookies() });
    const json = await response.json();

    assert.equal(response.status, 400);
    assert.equal(json.code, 'INVALID_RUN_DATA');
    assert.equal(json.details[0].field, 'durationMs');
  });

  test('personagem inexistente: 422 CHARACTER_NOT_FOUND', async () => {
    const response = await postRun({ ...body, characterId: 'nao-existe' }, { cookies: await loginCookies() });

    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, 'CHARACTER_NOT_FOUND');
  });

  test('logado: 201, grava com o id da sessão (ignora userId do corpo)', async () => {
    const response = await postRun({ ...body, userId: '00000000-0000-0000-0000-000000000000' }, { cookies: await loginCookies() });
    const json = await response.json();

    assert.equal(response.status, 201);
    assert.equal(json.run.durationMs, 650000);

    const saved = await db.query('select user_id from public.game_runs where id = $1', [json.run.id]);
    assert.equal(saved.rows[0].user_id, account.id);
  });
});
