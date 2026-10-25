import 'dotenv/config';
import pg from 'pg';

import { buildPoolConfig } from '../../src/config/database.js';

export const requireEnv = (name) => {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}. Consulte o .env.example.`);
  }

  return value.trim();
};

// Cria uma conexão única para scripts (migração, seed, contas de teste).
// Diferente da API, aqui o DATABASE_URL é obrigatório: não há valor padrão.
export const createScriptClient = async () => {
  const databaseUrl = requireEnv('DATABASE_URL');
  const client = new pg.Client(buildPoolConfig(databaseUrl));

  await client.connect();
  return client;
};
