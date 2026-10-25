import { createScriptClient } from './lib/scriptDatabase.js';
import { runSeeds } from './lib/sqlRunner.js';

const main = async () => {
  const client = await createScriptClient();

  try {
    const executed = await runSeeds(client);

    for (const fileName of executed) {
      console.log(`[seed] Executado: ${fileName}`);
    }
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error('[seed] Erro:', error.message);
  process.exitCode = 1;
});
