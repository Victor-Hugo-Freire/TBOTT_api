import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  findProgressByUserId,
  hasProgressByUserId,
  upsertProgress
} from '../src/repository/progressRepository.js';
import { insertRun } from '../src/repository/runRepository.js';
import {
  createProgressSchema,
  getProgress,
  hasProgress,
  saveProgress
} from '../src/service/progressService.js';
import { createAuthUser, createTestDatabase } from './helpers/testDatabase.js';

let pglite;
let db;
let userA;
let userB;

const validProgress = {
  andar: 1,
  sala: 'inicial',
  graos: 4,
  garfos: 2,
  itens: ['cafe-duplo']
};

before(async () => {
  ({ pglite, db } = await createTestDatabase());
  userA = await createAuthUser(db, { email: 'progress.a@example.com', username: 'ProgressA' });
  userB = await createAuthUser(db, { email: 'progress.b@example.com', username: 'ProgressB' });
});

after(async () => {
  await pglite.close();
});

describe('validação do payload de progresso', () => {
  test('aceita objetos JSON genéricos', () => {
    const parsed = createProgressSchema.parse(validProgress);
    assert.deepEqual(parsed, validProgress);
  });

  test('rejeita payloads que não são objetos', () => {
    const invalidBodies = [null, 'texto', 123, [], true, undefined];

    for (const body of invalidBodies) {
      assert.equal(createProgressSchema.safeParse(body).success, false, JSON.stringify(body));
    }
  });
});

describe('persistência do progresso por usuário', () => {
  test('salva e recupera o progresso do jogador autenticado', async () => {
    const saved = await saveProgress(userA, validProgress, {
      db,
      repo: { upsertProgress: (data) => upsertProgress(data, db) }
    });

    assert.deepEqual(saved.progress, validProgress);
    assert.equal(saved.exists, true);

    const row = await findProgressByUserId(userA, db);
    assert.deepEqual(row.payload, validProgress);
    assert.equal(row.user_id, userA);
  });

  test('indica ausência de progresso quando o usuário não possui salvo', async () => {
    const result = await getProgress(userB, db);

    assert.deepEqual(result, { exists: false, progress: null });
    assert.equal(await hasProgressByUserId(userB, db), false);
    assert.equal(await hasProgress(userB, db), false);
  });

  test('salvar novamente substitui a versão anterior', async () => {
    const initial = { room: 'sala-1', hp: 5 };
    const next = { room: 'sala-2', hp: 2, flags: ['novo'] };

    await saveProgress(userA, initial, {
      db,
      repo: { upsertProgress: (data) => upsertProgress(data, db) }
    });
    await saveProgress(userA, next, {
      db,
      repo: { upsertProgress: (data) => upsertProgress(data, db) }
    });

    const row = await findProgressByUserId(userA, db);
    assert.deepEqual(row.payload, next);

    const count = await db.query('select count(*) as total from public.player_progress where user_id = $1', [userA]);
    assert.equal(Number(count.rows[0].total), 1);
  });

  test('consulta de existência retorna verdadeiro apenas para o usuário correto', async () => {
    const updated = { stage: 'boss', hp: 1 };
    await saveProgress(userA, updated, {
      db,
      repo: { upsertProgress: (data) => upsertProgress(data, db) }
    });

    assert.equal(await hasProgressByUserId(userA, db), true);
    assert.equal(await hasProgressByUserId(userB, db), false);
    assert.equal(await hasProgress(userA, db), true);
    assert.equal(await hasProgress(userB, db), false);
  });
});

describe('isolamento entre usuários', () => {
  test('usuário A não consegue recuperar o progresso de B', async () => {
    const other = await findProgressByUserId(userB, db);
    assert.equal(other, null);
  });

  test('o userId do cliente é ignorado e não permite acessar dados de terceiros', async () => {
    const payload = { currentRoom: 'secret-room', userId: userB };
    const saved = await saveProgress(userA, payload, {
      db,
      repo: { upsertProgress: (data) => upsertProgress(data, db) }
    });

    assert.deepEqual(saved.progress, { currentRoom: 'secret-room' });

    const rowA = await findProgressByUserId(userA, db);
    const rowB = await findProgressByUserId(userB, db);

    assert.deepEqual(rowA.payload, { currentRoom: 'secret-room' });
    assert.equal(rowB, null);
  });
});

describe('fim da run', () => {
  test('registrar a run apaga só o progresso do jogador (o Continue desliga)', async () => {
    await upsertProgress({ userId: userA, payload: validProgress }, db);
    await upsertProgress({ userId: userB, payload: validProgress }, db);

    await insertRun({ userId: userA, characterId: 'tung-tung-sahur', status: 'defeat', durationMs: 1000 }, db);

    assert.equal(await hasProgress(userA, db), false);
    assert.equal(await hasProgress(userB, db), true);
  });

  test('se a run não for gravada, o progresso continua salvo', async () => {
    await upsertProgress({ userId: userA, payload: validProgress }, db);

    await assert.rejects(
      insertRun({ userId: userA, characterId: 'nao-existe', status: 'victory', durationMs: 1000 }, db),
      { code: 'CHARACTER_NOT_FOUND' }
    );

    assert.equal(await hasProgress(userA, db), true);
  });
});
