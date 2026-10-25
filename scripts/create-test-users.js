// Cria contas FICTÍCIAS de teste pelo Supabase Auth (API Admin oficial) e algumas runs
// de exemplo para popular o ranking. Pode ser executado várias vezes sem duplicar dados.
//
// Requer no .env (somente no servidor, nunca no front-end):
//   DATABASE_URL, SUPABASE_URL, SUPABASE_SECRET_KEY e TEST_USERS_PASSWORD
// Antes, rode "npm run db:migrate" e "npm run db:seed".

import { createScriptClient, requireEnv } from './lib/scriptDatabase.js';

const TEST_CHARACTER_ID = 'tung-tung-sahur';

// Durações em milissegundos. Ex.: 650000 ms = 10:50
const TEST_USERS = [
  {
    email: 'teste.jogador1@example.com',
    username: 'teste_jogador1',
    runs: [
      { status: 'victory', durationMs: 650000 },
      { status: 'defeat', durationMs: 120000 }
    ]
  },
  {
    email: 'teste.jogador2@example.com',
    username: 'teste_jogador2',
    runs: [
      { status: 'victory', durationMs: 754000 },
      { status: 'victory', durationMs: 812000 }
    ]
  },
  {
    email: 'teste.jogador3@example.com',
    username: 'teste_jogador3',
    // Sem vitória: não deve aparecer no ranking.
    runs: [
      { status: 'in_progress', durationMs: null }
    ]
  }
];

const isEmailAlreadyRegistered = (body) => {
  const message = String(body.msg ?? body.message ?? '');

  return body.error_code === 'email_exists' || message.includes('already been registered');
};

const createAuthUser = async ({ supabaseUrl, secretKey, password }, user) => {
  const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: user.email,
      password,
      email_confirm: true,
      user_metadata: { username: user.username }
    })
  });

  if (response.ok) {
    return 'criada';
  }

  const body = await response.json().catch(() => ({}));

  if (isEmailAlreadyRegistered(body)) {
    return 'já existia';
  }

  throw new Error(`Falha ao criar ${user.email}: HTTP ${response.status} ${body.msg ?? body.message ?? ''}`);
};

const findUserIdByEmail = async (client, email) => {
  // Apenas leitura de auth.users. A criação é sempre feita pela API do Supabase Auth.
  const result = await client.query('select id from auth.users where email = $1', [email]);

  return result.rows[0]?.id ?? null;
};

const insertTestRunsIfEmpty = async (client, userId, runs) => {
  const existing = await client.query(
    'select count(*)::int as total from public.game_runs where user_id = $1',
    [userId]
  );

  if (existing.rows[0].total > 0) {
    return 0;
  }

  for (const run of runs) {
    await client.query(
      `insert into public.game_runs (user_id, character_id, status, duration_ms, started_at, finished_at)
       values (
         $1,
         $2,
         $3::text,
         $4::integer,
         now() - make_interval(secs => coalesce($4::integer, 0) / 1000.0),
         case when $3::text = 'in_progress' then null else now() end
       )`,
      [userId, TEST_CHARACTER_ID, run.status, run.durationMs]
    );
  }

  return runs.length;
};

const ensureCharacterExists = async (client) => {
  const result = await client.query('select 1 from public.characters where id = $1', [TEST_CHARACTER_ID]);

  if (result.rowCount === 0) {
    throw new Error(`Personagem "${TEST_CHARACTER_ID}" não encontrado. Rode "npm run db:seed" antes.`);
  }
};

const main = async () => {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Este script cria dados fictícios e não pode rodar com NODE_ENV=production.');
  }

  const authConfig = {
    supabaseUrl: requireEnv('SUPABASE_URL').replace(/\/$/, ''),
    secretKey: requireEnv('SUPABASE_SECRET_KEY'),
    password: requireEnv('TEST_USERS_PASSWORD')
  };

  if (authConfig.password.length < 8) {
    throw new Error('TEST_USERS_PASSWORD precisa ter pelo menos 8 caracteres.');
  }

  const client = await createScriptClient();

  try {
    await ensureCharacterExists(client);

    for (const user of TEST_USERS) {
      const accountStatus = await createAuthUser(authConfig, user);
      const userId = await findUserIdByEmail(client, user.email);

      if (!userId) {
        throw new Error(`Conta ${user.email} não encontrada em auth.users após a criação.`);
      }

      const insertedRuns = await insertTestRunsIfEmpty(client, userId, user.runs);
      console.log(`[test-users] ${user.email}: conta ${accountStatus}, ${insertedRuns} run(s) inserida(s).`);
    }
  } finally {
    await client.end();
  }
};

main().catch((error) => {
  console.error('[test-users] Erro:', error.message);
  process.exitCode = 1;
});
