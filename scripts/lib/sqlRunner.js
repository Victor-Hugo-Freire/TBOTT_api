import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MIGRATIONS_DIR = fileURLToPath(new URL('../../db/migrations', import.meta.url));
export const SEEDS_DIR = fileURLToPath(new URL('../../db/seeds', import.meta.url));

// Guarda quais migrações já foram aplicadas, para nunca rodar a mesma duas vezes.
// Só o dono da tabela (o papel do DATABASE_URL) acessa: sem privilégios para os papéis
// da Data API e com RLS ativado sem políticas. Os comandos são idempotentes;
// a migração 0004 registra a mesma proteção no histórico dos bancos já existentes.
const CREATE_MIGRATIONS_TABLE = `
  create table if not exists public.schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  );
  revoke all privileges on table public.schema_migrations from anon, authenticated, service_role, public;
  alter table public.schema_migrations enable row level security;
`;

// Arquivos .sql em ordem alfabética: 0001_..., 0002_..., 0003_...
export const listSqlFiles = async (directory) => {
  const fileNames = await readdir(directory);

  return fileNames
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
};

// Executa um arquivo SQL dentro de uma transação: ou tudo é aplicado, ou nada.
const runFileInTransaction = async (client, filePath, afterRun) => {
  const sql = await readFile(filePath, 'utf8');

  await client.query('begin');

  try {
    await client.query(sql);

    if (afterRun) {
      await afterRun();
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw new Error(`Falha ao executar ${path.basename(filePath)}: ${error.message}`, { cause: error });
  }
};

export const applyMigrations = async (client, directory = MIGRATIONS_DIR) => {
  await client.query(CREATE_MIGRATIONS_TABLE);

  const result = await client.query('select version from public.schema_migrations');
  const appliedVersions = new Set(result.rows.map((row) => row.version));
  const appliedNow = [];

  for (const fileName of await listSqlFiles(directory)) {
    const version = fileName.replace(/\.sql$/, '');

    if (appliedVersions.has(version)) {
      continue;
    }

    await runFileInTransaction(client, path.join(directory, fileName), () => client.query(
      'insert into public.schema_migrations (version) values ($1)',
      [version]
    ));

    appliedNow.push(version);
  }

  return appliedNow;
};

// Seeds rodam sempre; por isso cada arquivo precisa ser idempotente (ex.: on conflict do update).
export const runSeeds = async (client, directory = SEEDS_DIR) => {
  const executed = [];

  for (const fileName of await listSqlFiles(directory)) {
    await runFileInTransaction(client, path.join(directory, fileName));
    executed.push(fileName);
  }

  return executed;
};
