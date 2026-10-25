import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { findAllCharacters } from '../src/repository/characterRepository.js';
import { findRanking } from '../src/repository/rankingRepository.js';
import { rankingQuerySchema, toPublicRankingEntry } from '../src/service/rankingService.js';
import { createAuthUser, createTestDatabase, insertRun } from './helpers/testDatabase.js';

let pglite;
let db;

before(async () => {
  ({ pglite, db } = await createTestDatabase());

  const ana = await createAuthUser(db, { email: 'ana@example.com', username: 'Ana' });
  const bia = await createAuthUser(db, { email: 'bia@example.com', username: 'Bia' });
  const caio = await createAuthUser(db, { email: 'caio@example.com', username: 'Caio' });
  const davi = await createAuthUser(db, { email: 'davi@example.com', username: 'Davi' });

  // Ana: várias runs; vale a melhor vitória (650000 ms). A derrota rápida não conta.
  await insertRun(db, { userId: ana, status: 'victory', durationMs: 700000, finishedAt: '2026-10-01T10:00:00Z' });
  await insertRun(db, { userId: ana, status: 'victory', durationMs: 650000, finishedAt: '2026-10-02T10:00:00Z' });
  await insertRun(db, { userId: ana, status: 'defeat', durationMs: 100000, finishedAt: '2026-10-03T10:00:00Z' });

  // Bia: mesmo tempo da Ana, mas terminou depois -> fica atrás no desempate.
  await insertRun(db, { userId: bia, status: 'victory', durationMs: 650000, finishedAt: '2026-10-05T10:00:00Z' });

  // Caio: só run em andamento -> fora do ranking.
  await insertRun(db, { userId: caio, status: 'in_progress' });

  // Davi: vitória mais lenta.
  await insertRun(db, { userId: davi, status: 'victory', durationMs: 900000, finishedAt: '2026-10-01T09:00:00Z' });
});

after(async () => {
  await pglite.close();
});

describe('ranking', () => {
  test('ordena pelo menor tempo, um resultado por jogador, só vitórias', async () => {
    const rows = await findRanking({ limit: 50, offset: 0 }, db);

    assert.deepEqual(
      rows.map((row) => [row.position, row.username, row.duration_ms]),
      [
        [1, 'Ana', 650000],
        [2, 'Bia', 650000],
        [3, 'Davi', 900000]
      ]
    );
  });

  test('respeita limit e offset mantendo a posição real', async () => {
    const rows = await findRanking({ limit: 1, offset: 1 }, db);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].position, 2);
    assert.equal(rows[0].username, 'Bia');
  });

  test('a resposta pública não expõe id de usuário nem e-mail', async () => {
    const [row] = await findRanking({ limit: 1, offset: 0 }, db);
    const entry = toPublicRankingEntry(row);

    assert.deepEqual(Object.keys(entry).sort(), ['character', 'durationMs', 'finishedAt', 'position', 'username']);
    assert.deepEqual(entry.character, { id: 'tung-tung-sahur', name: 'Tung Tung Sahur' });
  });
});

describe('validação dos parâmetros do ranking', () => {
  test('usa valores padrão quando nada é informado', () => {
    assert.deepEqual(rankingQuerySchema.parse({}), { limit: 50, offset: 0 });
  });

  test('converte números vindos da URL', () => {
    assert.deepEqual(rankingQuerySchema.parse({ limit: '10', offset: '20' }), { limit: 10, offset: 20 });
  });

  test('rejeita valores inválidos', () => {
    for (const query of [{ limit: '0' }, { limit: '101' }, { limit: 'abc' }, { limit: '2.5' }, { offset: '-1' }]) {
      assert.equal(rankingQuerySchema.safeParse(query).success, false, JSON.stringify(query));
    }
  });
});

describe('catálogo de personagens', () => {
  test('lista os personagens pelo display_order, e não pelo nome', async () => {
    // "Aaa" viria antes de "Tung" em ordem alfabética, mas display_order = 2 o coloca depois.
    await db.query("insert into public.characters (id, name, display_order) values ('personagem-teste', 'Aaa Teste', 2)", []);

    try {
      const rows = await findAllCharacters(db);

      assert.deepEqual(rows.map((row) => [row.id, row.display_order]), [
        ['tung-tung-sahur', 1],
        ['personagem-teste', 2]
      ]);
      assert.equal(rows[0].description, 'Ataca inimigos próximos usando um bastão.');
    } finally {
      await db.query("delete from public.characters where id = 'personagem-teste'", []);
    }
  });
});
