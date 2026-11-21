import './helpers/fakeEnv.js';

import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';

import app from '../src/app.js';
import { closeDatabasePool } from '../src/config/database.js';
import { findProfileById } from '../src/repository/profileRepository.js';
import { startFakeAuthServer } from './helpers/fakeAuthServer.js';
import { createAuthUser, createTestDatabase } from './helpers/testDatabase.js';

// Testes HTTP de GET /api/catalog: app, requireAuth, controller, service e repositório reais.
// O Supabase Auth é o simulado e o banco é o PostgreSQL em memória, já com as migrações e os seeds.

const PASSWORD = 'Senha-Teste-123';
const FRONTEND = 'http://localhost:5173';

let pglite;
let db;
let server;
let baseUrl;
let authServer;
let cookies;

before(async () => {
  ({ pglite, db } = await createTestDatabase());
  authServer = await startFakeAuthServer();
  process.env.SUPABASE_URL = authServer.url;

  const email = 'ana@example.com';
  const id = await createAuthUser(db, { email, username: 'Ana' });
  authServer.addAccount({ id, email, password: PASSWORD, confirmed: true });

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  // Um login só para todos os testes: o catálogo é igual para qualquer jogador.
  app.locals.authContext = { repo: { findProfileById: (profileId) => findProfileById(profileId, db) } };
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: FRONTEND },
    body: JSON.stringify({ email, password: PASSWORD })
  });
  assert.equal(login.status, 200);
  cookies = login.headers.getSetCookie().map((line) => line.split(';')[0]).join('; ');
});

after(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await authServer.close();
  await closeDatabasePool();
  await pglite.close();
});

beforeEach(() => {
  app.locals.authContext = { repo: { findProfileById: (profileId) => findProfileById(profileId, db) } };
  app.locals.gameCatalogContext = { db };
});

afterEach(() => {
  delete app.locals.authContext;
  delete app.locals.gameCatalogContext;
});

const getCatalog = (cookie) => fetch(`${baseUrl}/api/catalog`, {
  headers: { origin: FRONTEND, ...(cookie ? { cookie } : {}) }
});

describe('GET /api/catalog', () => {
  test('sem sessão: 401 AUTH_SESSION_MISSING', async () => {
    const response = await getCatalog();

    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'AUTH_SESSION_MISSING');
  });

  test('logado: 200 com todos os itens, inimigos e chefes de uma vez', async () => {
    const response = await getCatalog(cookies);
    const catalog = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(catalog).sort(), ['bosses', 'enemies', 'items']);
    assert.equal(catalog.items.length, 12);
    assert.equal(catalog.enemies.length, 10);
    assert.equal(catalog.bosses.length, 8);
  });

  test('item: campos em camelCase, efeito e salas já como objeto e lista', async () => {
    const { items } = await (await getCatalog(cookies)).json();
    const tiramisu = items.find((item) => item.id === 'tiramisu');

    assert.deepEqual(tiramisu, {
      id: 'tiramisu',
      name: 'Tiramisu',
      description: 'Cada golpe que acerta deixa o golpe e o passo mais rápidos por alguns segundos.',
      type: 'passivo',
      rarity: 'incomum',
      effect: { trigger: 'golpe-acerta', attackSpeedBonus: 0.25, moveSpeedMultiplier: 1.2, bonusDurationMs: 2000 },
      roomTypes: ['loja'],
      price: 15,
      spritePath: '/sprites/items/tiramisu/tiramisu.png',
      iconPath: '/sprites/items/tiramisu/tiramisu-icone.png'
    });
  });

  test('inimigo: vida, dano e velocidade em número e os dois caminhos de sprite', async () => {
    const { enemies } = await (await getCatalog(cookies)).json();
    const pistacchio = enemies.find((enemy) => enemy.id === 'pistacchio-sputacchio');

    assert.deepEqual(pistacchio, {
      id: 'pistacchio-sputacchio',
      name: 'Pistacchio Sputacchio',
      description: 'Abre a casca e cospe um caroço.',
      health: 6,
      damage: 1,
      speed: 90,
      behavior: 'atirar',
      minFloor: 1,
      spriteLegsPath: '/sprites/enemies/pistacchio-sputacchio/pistacchio-sputacchio-pernas.png',
      spriteBodyPath: '/sprites/enemies/pistacchio-sputacchio/pistacchio-sputacchio-tronco.png'
    });
  });

  test('chefe: lista de ataques e faixa de andares', async () => {
    const { bosses } = await (await getCatalog(cookies)).json();
    const bombardiro = bosses.find((boss) => boss.id === 'bombardiro-crocodilo');

    assert.deepEqual(bombardiro, {
      id: 'bombardiro-crocodilo',
      name: 'Bombardiro Crocodilo',
      description: 'Marca o chão e bombardeia; pousa para abastecer.',
      health: 90,
      damage: 1,
      attacks: [{ id: 'atacando', name: 'Bombardeio', damage: 2 }],
      minFloor: 3,
      maxFloor: 4,
      spriteLegsPath: '/sprites/bosses/bombardiro-crocodilo/bombardiro-crocodilo-pernas.png',
      spriteBodyPath: '/sprites/bosses/bombardiro-crocodilo/bombardiro-crocodilo-tronco.png'
    });
  });

  test('só o Tralalero Tralala é chefe do andar 5, e os andares 1 a 4 têm mais de um chefe para sortear', async () => {
    const { bosses } = await (await getCatalog(cookies)).json();

    for (let floor = 1; floor <= 5; floor++) {
      const ids = [];

      for (const boss of bosses) {
        if (boss.minFloor <= floor && floor <= boss.maxFloor) {
          ids.push(boss.id);
        }
      }

      if (floor === 5) {
        assert.deepEqual(ids, ['tralalero-tralala']);
      } else {
        assert.ok(ids.length > 1, `andar ${floor}: ${ids.join(', ')}`);
      }
    }
  });

  test('todo sprite é um caminho de PNG dentro da pasta da própria entidade', async () => {
    const catalog = await (await getCatalog(cookies)).json();

    for (const item of catalog.items) {
      assert.equal(item.spritePath, `/sprites/items/${item.id}/${item.id}.png`);
      assert.equal(item.iconPath, `/sprites/items/${item.id}/${item.id}-icone.png`);
    }

    for (const enemy of catalog.enemies) {
      assert.equal(enemy.spriteLegsPath, `/sprites/enemies/${enemy.id}/${enemy.id}-pernas.png`);
      assert.equal(enemy.spriteBodyPath, `/sprites/enemies/${enemy.id}/${enemy.id}-tronco.png`);
    }

    for (const boss of catalog.bosses) {
      assert.equal(boss.spriteLegsPath, `/sprites/bosses/${boss.id}/${boss.id}-pernas.png`);
      assert.equal(boss.spriteBodyPath, `/sprites/bosses/${boss.id}/${boss.id}-tronco.png`);
    }
  });

  test('banco fora do ar: 503 CATALOG_QUERY_FAILED, sem repassar o erro do banco', async () => {
    app.locals.gameCatalogContext = {
      db: {
        query: async () => {
          throw new Error('senha do banco exposta');
        }
      }
    };

    const response = await getCatalog(cookies);
    const json = await response.json();

    assert.equal(response.status, 503);
    assert.equal(json.code, 'CATALOG_QUERY_FAILED');
    assert.doesNotMatch(JSON.stringify(json), /senha do banco/);
  });
});
