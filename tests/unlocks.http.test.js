import './helpers/fakeEnv.js';

import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';

import app from '../src/app.js';
import { closeDatabasePool } from '../src/config/database.js';
import { findProfileById } from '../src/repository/profileRepository.js';
import { startFakeAuthServer } from './helpers/fakeAuthServer.js';
import { createAuthUser, createTestDatabase } from './helpers/testDatabase.js';

// Testes HTTP de GET e POST /api/unlocks: app, CSRF, requireAuth, controller, service e repositório reais.
// O Supabase Auth é o simulado e o banco é o PostgreSQL em memória.

const PASSWORD = 'Senha-Teste-123';
const FRONTEND = 'http://localhost:5173';
const EVIL = 'http://site-malicioso.example';

let pglite;
let db;
let server;
let baseUrl;
let authServer;
let ana;
let beto;

before(async () => {
  ({ pglite, db } = await createTestDatabase());
  authServer = await startFakeAuthServer();
  process.env.SUPABASE_URL = authServer.url;

  ana = await createAccount('ana@example.com', 'Ana');
  beto = await createAccount('beto@example.com', 'Beto');

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
  app.locals.unlockContext = { db };
});

afterEach(async () => {
  delete app.locals.authContext;
  delete app.locals.unlockContext;
  await db.query('delete from public.character_unlocks', []);
});

async function createAccount(email, username) {
  const id = await createAuthUser(db, { email, username });
  authServer.addAccount({ id, email, password: PASSWORD, confirmed: true });

  return { id, email };
}

const loginCookies = async (account) => {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: FRONTEND },
    body: JSON.stringify({ email: account.email, password: PASSWORD })
  });
  assert.equal(response.status, 200);

  return response.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ');
};

const getUnlocks = (cookies) => fetch(`${baseUrl}/api/unlocks`, {
  headers: cookies ? { cookie: cookies } : {}
});

const postUnlock = (payload, { cookies, origin = FRONTEND } = {}) => fetch(`${baseUrl}/api/unlocks`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(cookies ? { cookie: cookies } : {}),
    ...(origin ? { origin } : {})
  },
  body: JSON.stringify(payload)
});

describe('POST /api/unlocks', () => {
  test('sem sessão: 401 AUTH_SESSION_MISSING', async () => {
    const response = await postUnlock({ characterId: 'tung-tung-sabor' });

    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'AUTH_SESSION_MISSING');
  });

  test('Origin de outro site: 403 ORIGIN_NOT_ALLOWED', async () => {
    const response = await postUnlock({ characterId: 'tung-tung-sabor' }, { cookies: await loginCookies(ana), origin: EVIL });

    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'ORIGIN_NOT_ALLOWED');
  });

  test('corpo inválido: 400 INVALID_UNLOCK_DATA com details', async () => {
    const response = await postUnlock({ characterId: '' }, { cookies: await loginCookies(ana) });
    const json = await response.json();

    assert.equal(response.status, 400);
    assert.equal(json.code, 'INVALID_UNLOCK_DATA');
    assert.equal(json.details[0].field, 'characterId');
  });

  test('personagem inexistente: 422 CHARACTER_NOT_FOUND e nada gravado', async () => {
    const response = await postUnlock({ characterId: 'nao-existe' }, { cookies: await loginCookies(ana) });

    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, 'CHARACTER_NOT_FOUND');

    const total = await db.query('select count(*)::int as total from public.character_unlocks', []);
    assert.equal(total.rows[0].total, 0);
  });

  test('logado: 201, grava com o id da sessão (ignora userId do corpo)', async () => {
    const response = await postUnlock(
      { characterId: 'tung-tung-sabor', userId: beto.id },
      { cookies: await loginCookies(ana) }
    );
    const json = await response.json();

    assert.equal(response.status, 201);
    assert.equal(json.created, true);
    assert.equal(json.unlock.characterId, 'tung-tung-sabor');
    assert.ok(json.unlock.unlockedAt);

    const saved = await db.query('select user_id, character_id from public.character_unlocks', []);
    assert.deepEqual(saved.rows, [{ user_id: ana.id, character_id: 'tung-tung-sabor' }]);
  });

  test('liberar de novo o mesmo personagem: 200 created = false, sem duplicar', async () => {
    const cookies = await loginCookies(ana);

    const first = await (await postUnlock({ characterId: 'tung-tung-god' }, { cookies })).json();
    const secondResponse = await postUnlock({ characterId: 'tung-tung-god' }, { cookies });
    const second = await secondResponse.json();

    assert.equal(secondResponse.status, 200);
    assert.equal(second.created, false);
    // devolve o registro que já existia (mesma data), e não um novo
    assert.equal(second.unlock.unlockedAt, first.unlock.unlockedAt);

    const total = await db.query('select count(*)::int as total from public.character_unlocks', []);
    assert.equal(total.rows[0].total, 1);
  });
});

describe('GET /api/unlocks', () => {
  test('sem sessão: 401 AUTH_SESSION_MISSING', async () => {
    const response = await getUnlocks();

    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'AUTH_SESSION_MISSING');
  });

  test('sem nenhum desbloqueio: lista vazia', async () => {
    const response = await getUnlocks(await loginCookies(ana));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { unlocks: [] });
  });

  test('cada jogador só vê os próprios desbloqueios', async () => {
    const anaCookies = await loginCookies(ana);
    const betoCookies = await loginCookies(beto);

    await postUnlock({ characterId: 'tung-tung-sabor' }, { cookies: anaCookies });
    await postUnlock({ characterId: 'tung-tung-god' }, { cookies: betoCookies });

    const anaUnlocks = (await (await getUnlocks(anaCookies)).json()).unlocks;
    const betoUnlocks = (await (await getUnlocks(betoCookies)).json()).unlocks;

    assert.deepEqual(anaUnlocks.map((unlock) => unlock.characterId), ['tung-tung-sabor']);
    assert.deepEqual(betoUnlocks.map((unlock) => unlock.characterId), ['tung-tung-god']);
  });
});

describe('catálogo de personagens e os desbloqueios', () => {
  test('o repositório lê starts_unlocked: só o Sahur já começa liberado', async () => {
    const { findAllCharacters } = await import('../src/repository/characterRepository.js');
    const rows = await findAllCharacters(db);

    assert.deepEqual(rows.map((row) => [row.id, row.starts_unlocked]), [
      ['tung-tung-sahur', true],
      ['tung-tung-sabor', false],
      ['tung-tung-god', false]
    ]);
  });
});
