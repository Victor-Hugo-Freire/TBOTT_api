import { readFile } from 'node:fs/promises';

import { PGlite } from '@electric-sql/pglite';

import { applyMigrations, runSeeds } from '../../scripts/lib/sqlRunner.js';

const STUB_PATH = new URL('./supabaseStub.sql', import.meta.url);

// Adapta o PGlite para a mesma interface do "pg": query(sql) e query(sql, params).
// Sem parâmetros, usamos exec(), que aceita vários comandos (como os arquivos de migração).
export const toQueryClient = (pglite) => ({
  query: async (sql, params) => {
    if (params) {
      return pglite.query(sql, params);
    }

    const results = await pglite.exec(sql);
    return results.at(-1) ?? { rows: [] };
  }
});

// Banco PostgreSQL em memória, com o stub do Supabase, migrações e seeds aplicados.
export const createTestDatabase = async () => {
  const pglite = new PGlite();
  await pglite.exec(await readFile(STUB_PATH, 'utf8'));

  const db = toQueryClient(pglite);
  await applyMigrations(db);
  await runSeeds(db);

  return { pglite, db };
};

// Simula um cadastro feito pelo Supabase Auth (que roda como supabase_auth_admin).
export const createAuthUser = async (db, { email, username }) => {
  await db.query('set role supabase_auth_admin');

  try {
    const result = await db.query(
      'insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id',
      [email, JSON.stringify(username === undefined ? {} : { username })]
    );

    return result.rows[0].id;
  } finally {
    await db.query('reset role');
  }
};

// Executa consultas como um jogador logado (papel authenticated + auth.uid()).
export const runAsUser = async (db, userId, callback) => {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.query('set role authenticated');

  try {
    return await callback();
  } finally {
    await db.query('reset role');
    await db.query("select set_config('request.jwt.claim.sub', '', false)", []);
  }
};

// Executa consultas com outro papel do PostgreSQL (ex.: anon, service_role).
export const runAsRole = async (db, role, callback) => {
  await db.query(`set role ${role}`);

  try {
    return await callback();
  } finally {
    await db.query('reset role');
  }
};

// Executa consultas como visitante sem login (papel anon).
export const runAsAnon = (db, callback) => runAsRole(db, 'anon', callback);

// Run em andamento: finishedAt e durationMs nulos (started_at fica como "agora").
export const insertRun = async (db, { userId, characterId = 'tung-tung-sahur', status, durationMs = null, finishedAt = null }) => {
  const result = await db.query(
    `insert into public.game_runs (user_id, character_id, status, duration_ms, started_at, finished_at)
     values ($1, $2, $3, $4, coalesce($5::timestamptz - interval '1 hour', now()), $5::timestamptz)
     returning id`,
    [userId, characterId, status, durationMs, finishedAt]
  );

  return result.rows[0].id;
};
