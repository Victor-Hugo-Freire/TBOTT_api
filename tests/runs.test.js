import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { findRanking } from '../src/repository/rankingRepository.js';
import { insertRun } from '../src/repository/runRepository.js';
import { createRun, createRunSchema, RUN_MAX_DURATION_MS } from '../src/service/runService.js';
import { createAuthUser, createTestDatabase } from './helpers/testDatabase.js';

let pglite;
let db;
let userId;

before(async () => {
  ({ pglite, db } = await createTestDatabase());
  userId = await createAuthUser(db, { email: 'ana@example.com', username: 'Ana' });
});

after(async () => {
  await pglite.close();
});

const validBody = { characterId: 'tung-tung-sahur', durationMs: 650000, status: 'victory' };

describe('validação do corpo de POST /api/runs', () => {
  test('aceita um corpo válido e descarta campos extras como userId', () => {
    const data = createRunSchema.parse({ ...validBody, userId: 'outro-jogador' });

    assert.deepEqual(data, validBody);
  });

  test('rejeita valores inválidos', () => {
    const invalidBodies = [
      { ...validBody, durationMs: 0 },
      { ...validBody, durationMs: -5 },
      { ...validBody, durationMs: 1.5 },
      { ...validBody, durationMs: '650000' },
      { ...validBody, durationMs: RUN_MAX_DURATION_MS + 1 },
      { ...validBody, status: 'in_progress' },
      { ...validBody, characterId: '   ' },
      { characterId: validBody.characterId },
      undefined
    ];

    for (const body of invalidBodies) {
      assert.equal(createRunSchema.safeParse(body).success, false, JSON.stringify(body));
    }
  });
});

describe('gravação da run', () => {
  test('grava a run encerrada, com início calculado a partir do tempo', async () => {
    const row = await insertRun({ userId, ...validBody }, db);

    assert.equal(row.duration_ms, 650000);
    assert.equal(row.status, 'victory');

    const saved = await db.query('select started_at, finished_at from public.game_runs where id = $1', [row.id]);
    const elapsed = new Date(saved.rows[0].finished_at) - new Date(saved.rows[0].started_at);
    assert.equal(elapsed, 650000);
  });

  test('personagem inexistente: 422 CHARACTER_NOT_FOUND', async () => {
    await assert.rejects(
      insertRun({ userId, ...validBody, characterId: 'nao-existe' }, db),
      { statusCode: 422, code: 'CHARACTER_NOT_FOUND' }
    );
  });

  test('createRun devolve o formato público', async () => {
    const run = await createRun(userId, validBody, { repo: { insertRun: (data) => insertRun(data, db) } });

    assert.deepEqual(Object.keys(run).sort(), ['characterId', 'durationMs', 'finishedAt', 'id', 'status']);
  });

  test('vitória aparece no ranking; derrota não', async () => {
    const other = await createAuthUser(db, { email: 'bia@example.com', username: 'Bia' });
    await insertRun({ userId: other, characterId: 'tung-tung-sahur', status: 'defeat', durationMs: 1000 }, db);

    const usernames = (await findRanking({ limit: 50, offset: 0 }, db)).map((row) => row.username);

    assert.ok(usernames.includes('Ana'));
    assert.ok(!usernames.includes('Bia'));
  });
});
