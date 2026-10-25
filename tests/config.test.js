import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildPoolConfig } from '../src/config/database.js';
import { requireEnv } from '../scripts/lib/scriptDatabase.js';

test('banco local não usa SSL', () => {
  const poolConfig = buildPoolConfig('postgresql://postgres:x@localhost:5432/postgres', '');
  assert.equal(poolConfig.ssl, undefined);
});

test('banco remoto com CA configurado valida o certificado', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'tbott-ca-'));
  const caPath = path.join(directory, 'ca.crt');
  await writeFile(caPath, 'certificado-de-teste');

  const poolConfig = buildPoolConfig('postgresql://user:x@db.example.supabase.co:5432/postgres', caPath);

  assert.equal(poolConfig.ssl.rejectUnauthorized, true);
  assert.equal(poolConfig.ssl.ca, 'certificado-de-teste');
});

test('banco remoto sem CA mantém a criptografia, mas sem validar o certificado', () => {
  const poolConfig = buildPoolConfig('postgresql://user:x@db.example.supabase.co:5432/postgres', '');
  assert.equal(poolConfig.ssl.rejectUnauthorized, false);
});

test('requireEnv falha com mensagem clara quando a variável está ausente ou vazia', () => {
  delete process.env.TBOTT_VARIAVEL_INEXISTENTE;
  assert.throws(() => requireEnv('TBOTT_VARIAVEL_INEXISTENTE'), /TBOTT_VARIAVEL_INEXISTENTE/);

  process.env.TBOTT_VARIAVEL_VAZIA = '   ';
  assert.throws(() => requireEnv('TBOTT_VARIAVEL_VAZIA'), /TBOTT_VARIAVEL_VAZIA/);
});

test('requireEnv retorna o valor sem espaços extras', () => {
  process.env.TBOTT_VARIAVEL_OK = '  valor  ';
  assert.equal(requireEnv('TBOTT_VARIAVEL_OK'), 'valor');
});
