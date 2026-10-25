import { createScriptClient } from './lib/scriptDatabase.js';
import { applyMigrations } from './lib/sqlRunner.js';

const main = async () => {
  const client = await createScriptClient();

  try {
    const applied = await applyMigrations(client);

    if (applied.length === 0) {
      console.log('[migrate] Nenhuma migração pendente. O banco já está atualizado.');
      return;
    }

    for (const version of applied) {
      console.log(`[migrate] Aplicada: ${version}`);
    }
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error('[migrate] Erro:', error.message);
  process.exitCode = 1;
});
