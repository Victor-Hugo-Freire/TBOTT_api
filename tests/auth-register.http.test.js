import './helpers/fakeEnv.js';

import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, mock, test } from 'node:test';
import { inspect } from 'node:util';

import app from '../src/app.js';
import { closeDatabasePool } from '../src/config/database.js';
import config from '../src/config/index.js';
import { createSwaggerSpec } from '../src/docs/catalog.js';
import { findProfileById, findProfileByUsername } from '../src/repository/profileRepository.js';
import { createFakeSupabaseAuth } from './helpers/fakeSupabaseAuth.js';
import { createTestDatabase } from './helpers/testDatabase.js';

// Testes HTTP do cadastro: app, controller, tratador de erros, service e repositórios reais,
// sobre o banco em memória com o gatilho da migração 0001. Só o Supabase Auth é simulado.

const PASSWORD = 'Senha-Teste-123';
const SECRET_IN_BROKEN_JSON = 'Senha-Super-Secreta-987';
const GENERIC_ERROR = 'Não foi possível concluir a operação no momento.';

let pglite;
let db;
let server;
let baseUrl;
let logLines = [];

before(async () => {
  ({ pglite, db } = await createTestDatabase());

  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await closeDatabasePool();
  await pglite.close();
});

// Captura os logs de cada teste e confere, em todos os cenários, que nenhuma senha
// nem e-mail foi registrado.
beforeEach(() => {
  logLines = [];
  for (const level of ['log', 'info', 'warn', 'error']) {
    mock.method(console, level, (...args) => {
      logLines.push(args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { depth: 5 }))).join(' '));
    });
  }
});

afterEach(() => {
  mock.restoreAll();
  delete app.locals.authContext;

  for (const line of logLines) {
    assert.ok(!line.includes(PASSWORD) && !line.includes(SECRET_IN_BROKEN_JSON), `senha no log: ${line}`);
    assert.ok(!line.includes('@example.com'), `e-mail no log: ${line}`);
  }
});

// Repositórios reais apontando para o banco em memória. Guarda as buscas de perfil por id.
const memoryRepo = () => {
  const profileLookups = [];

  return {
    profileLookups,
    usernameExists: (username) => findProfileByUsername(username, db),
    findProfileById: (id) => {
      profileLookups.push(id);
      return findProfileById(id, db);
    }
  };
};

// O controller repassa app.locals.authContext para o service (veja authController.js).
const useDependencies = (dependencies) => {
  app.locals.authContext = dependencies;
};

const register = async (body, contentType = 'application/json') => {
  const response = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  const text = await response.text();

  return { status: response.status, text, body: JSON.parse(text) };
};

const countAccounts = async (email) => {
  const result = await db.query('select count(*)::int as total from auth.users where email = $1', [email]);
  return result.rows[0].total;
};

const countProfilesNamed = async (username) => {
  const result = await db.query('select count(*)::int as total from public.profiles where lower(username) = lower($1)', [username]);
  return result.rows[0].total;
};

describe('POST /api/auth/register: fluxo completo', () => {
  test('cadastro válido: 201, conta no Auth e perfil com o mesmo id', async () => {
    useDependencies({ supabase: createFakeSupabaseAuth(db), repo: memoryRepo() });

    const { status, body, text } = await register({ username: 'Ana_Silva', email: 'ana.silva@example.com', password: PASSWORD });

    assert.equal(status, 201);
    assert.deepEqual(Object.keys(body).sort(), ['profile', 'requiresEmailConfirmation', 'status', 'user', 'usernameChanged']);
    assert.equal(body.status, 'pending_email_confirmation');
    assert.equal(body.requiresEmailConfirmation, true);
    assert.equal(body.usernameChanged, false);
    assert.equal(body.user.email, 'ana.silva@example.com');
    assert.deepEqual(body.profile, { id: body.user.id, username: 'Ana_Silva' });
    assert.doesNotMatch(text, /token|Senha-Teste/);

    const rows = await db.query(`
      select u.id, u.raw_user_meta_data ->> 'username' as requested, p.username
      from auth.users u
      join public.profiles p on p.id = u.id
      where u.email = $1
    `, ['ana.silva@example.com']);
    assert.deepEqual(rows.rows, [{ id: body.user.id, requested: 'Ana_Silva', username: 'Ana_Silva' }]);
  });

  test('confirmação de e-mail desligada: 201 com status registered e sem tokens', async () => {
    useDependencies({ supabase: createFakeSupabaseAuth(db, { confirmEmail: false }), repo: memoryRepo() });

    const { status, body, text } = await register({ username: 'Bruno_Reis', email: 'bruno@example.com', password: PASSWORD });

    assert.equal(status, 201);
    assert.equal(body.status, 'registered');
    assert.equal(body.requiresEmailConfirmation, false);
    assert.doesNotMatch(text, /token/);
  });

  test('nome já usado com outra capitalização: 409 e nenhuma conta nova', async () => {
    const supabase = createFakeSupabaseAuth(db);
    useDependencies({ supabase, repo: memoryRepo() });
    assert.equal((await register({ username: 'Bia_Costa', email: 'bia@example.com', password: PASSWORD })).status, 201);

    const { status, body } = await register({ username: 'BIA_COSTA', email: 'bia.outra@example.com', password: PASSWORD });

    assert.equal(status, 409);
    assert.deepEqual(body, { error: 'Nome de usuário já está em uso.', code: 'USERNAME_ALREADY_EXISTS' });
    assert.equal(await countAccounts('bia.outra@example.com'), 0);
    assert.equal(supabase.signUpCalls.length, 1);
  });

  test('E1: e-mail já confirmado, com a confirmação ligada: 409 sem procurar perfil pelo id falso', async () => {
    const supabase = createFakeSupabaseAuth(db, { confirmEmail: true });
    const repo = memoryRepo();
    useDependencies({ supabase, repo });

    const first = await register({ username: 'Caio_Lima', email: 'caio@example.com', password: PASSWORD });
    assert.equal(first.status, 201);
    supabase.confirm('caio@example.com');

    const { status, body } = await register({ username: 'Caio_Outro', email: 'caio@example.com', password: PASSWORD });

    assert.equal(status, 409);
    assert.deepEqual(body, { error: 'Este e-mail já está cadastrado.', code: 'AUTH_USER_ALREADY_EXISTS' });
    assert.deepEqual(repo.profileLookups, [first.body.user.id]);
    assert.equal(await countAccounts('caio@example.com'), 1);
    assert.equal(await countProfilesNamed('Caio_Outro'), 0);
  });

  test('e-mail repetido com a confirmação desligada (erro explícito do Supabase): 409', async () => {
    useDependencies({ supabase: createFakeSupabaseAuth(db, { confirmEmail: false }), repo: memoryRepo() });
    assert.equal((await register({ username: 'Eva_Rocha', email: 'eva@example.com', password: PASSWORD })).status, 201);

    const { status, body } = await register({ username: 'Eva_Outra', email: 'eva@example.com', password: PASSWORD });

    assert.equal(status, 409);
    assert.deepEqual(body, { error: 'Este e-mail já está cadastrado.', code: 'AUTH_USER_ALREADY_EXISTS' });
    assert.equal(await countProfilesNamed('Eva_Outra'), 0);
  });

  test('E2: dois cadastros simultâneos com o mesmo nome: os dois recebem 201 e um deles, nome provisório', { timeout: 10000 }, async () => {
    // Barreira: o signUp só continua quando as DUAS requisições já passaram pela verificação
    // do nome. Assim a disputa acontece sempre, sem depender de tempo.
    let arrived = 0;
    let releaseBoth;
    const bothChecked = new Promise((resolve) => {
      releaseBoth = resolve;
    });
    const supabase = createFakeSupabaseAuth(db, {
      beforeSignUp: async () => {
        arrived += 1;
        if (arrived === 2) {
          releaseBoth();
        }
        await bothChecked;
      }
    });
    useDependencies({ supabase, repo: memoryRepo() });

    const responses = await Promise.all([
      register({ username: 'Disputado', email: 'disputa1@example.com', password: PASSWORD }),
      register({ username: 'disputado', email: 'disputa2@example.com', password: PASSWORD })
    ]);

    assert.deepEqual(responses.map((response) => response.status), [201, 201]);
    const kept = responses.find((response) => response.body.usernameChanged === false);
    const changed = responses.find((response) => response.body.usernameChanged === true);
    assert.ok(kept && changed, 'um cadastro mantém o nome e o outro recebe nome provisório');
    assert.equal(kept.body.profile.username.toLowerCase(), 'disputado');
    assert.match(changed.body.profile.username, /^jogador_[0-9a-f]{12}$/);

    // As duas contas existem, cada perfil está ligado à sua conta e o nome continua único.
    for (const { body } of responses) {
      const rows = await db.query(`
        select p.username
        from auth.users u
        join public.profiles p on p.id = u.id
        where u.id = $1 and u.email = $2
      `, [body.user.id, body.user.email]);
      assert.deepEqual(rows.rows, [{ username: body.profile.username }]);
    }
    assert.equal(await countProfilesNamed('Disputado'), 1);
  });

  test('cadastro pendente repetido com outro nome: 201 com o nome original e usernameChanged = true', async () => {
    useDependencies({ supabase: createFakeSupabaseAuth(db, { confirmEmail: true }), repo: memoryRepo() });
    const first = await register({ username: 'Davi_Original', email: 'davi@example.com', password: PASSWORD });

    const { status, body } = await register({ username: 'Davi_Novo', email: 'davi@example.com', password: PASSWORD });

    assert.equal(status, 201);
    assert.equal(body.usernameChanged, true);
    assert.deepEqual(body.profile, { id: first.body.user.id, username: 'Davi_Original' });
    assert.equal(await countAccounts('davi@example.com'), 1);
    assert.equal(await countProfilesNamed('Davi_Novo'), 0);
  });

  test('perfil ausente (gatilho não instalado): 502 com mensagem genérica e dica no log', async () => {
    // A conta "existe" no Auth (id que não está no banco), mas nenhum gatilho criou o perfil.
    const supabase = {
      auth: {
        signUp: async ({ email }) => ({
          data: {
            user: { id: '99999999-9999-4999-8999-999999999999', email, identities: [{ provider: 'email' }] },
            session: null
          },
          error: null
        })
      }
    };
    useDependencies({ supabase, repo: memoryRepo() });

    const { status, body } = await register({ username: 'Sem_Perfil', email: 'semperfil@example.com', password: PASSWORD });

    assert.equal(status, 502);
    assert.deepEqual(body, { error: GENERIC_ERROR, code: 'PROFILE_NOT_CREATED' });
    assert.ok(logLines.some((line) => line.includes('PROFILE_NOT_CREATED') && line.includes('migração 0001')));
  });
});

describe('erros HTTP e tratador global', () => {
  test('JSON malformado: 400 INVALID_JSON sem trecho do corpo nem detalhes do parser', async () => {
    const brokenBodies = [
      `{"username":"jogador_json","email":"json@example.com","password":${SECRET_IN_BROKEN_JSON}}`,
      `{"username":"jogador_json","password":"${SECRET_IN_BROKEN_JSON}`
    ];

    for (const brokenBody of brokenBodies) {
      const { status, body, text } = await register(brokenBody);

      assert.equal(status, 400);
      assert.deepEqual(body, { error: 'O corpo da requisição não é um JSON válido.', code: 'INVALID_JSON' });
      assert.ok(!text.includes('Senha-Su'), 'a resposta não pode conter nenhum pedaço da senha');
      assert.doesNotMatch(text, /jogador_json|Unexpected|position|not valid JSON/);
    }
  });

  test('dados ausentes: 400 INVALID_REGISTER_DATA com uma mensagem em português por campo', async () => {
    const { status, body } = await register({});

    assert.equal(status, 400);
    assert.deepEqual(body, {
      error: 'Dados de cadastro inválidos.',
      code: 'INVALID_REGISTER_DATA',
      details: [
        { field: 'username', message: 'Nome de usuário é obrigatório.' },
        { field: 'email', message: 'E-mail é obrigatório.' },
        { field: 'password', message: 'Senha é obrigatória.' }
      ]
    });
  });

  test('senha só com espaços: 400 explicando a regra', async () => {
    const { status, body } = await register({ username: 'Nome_Ok', email: 'nome.ok@example.com', password: ' '.repeat(10) });

    assert.equal(status, 400);
    assert.deepEqual(body.details, [{ field: 'password', message: 'Senha não pode conter apenas espaços.' }]);
  });

  test('corpo que não é JSON (text/plain): 400 INVALID_REGISTER_DATA', async () => {
    const { status, body } = await register('username=jogador', 'text/plain');

    assert.equal(status, 400);
    assert.equal(body.code, 'INVALID_REGISTER_DATA');
    assert.deepEqual(body.details, [{ field: 'request', message: 'O corpo da requisição deve ser um objeto JSON.' }]);
  });

  test('corpo grande demais continua 413, sem repassar a mensagem interna', async () => {
    const { status, body } = await register({ username: 'grande', email: 'grande@example.com', password: 'x'.repeat(120000) });

    assert.equal(status, 413);
    assert.deepEqual(body, { error: 'Requisição inválida.', code: 'INVALID_REQUEST' });
  });

  test('outras rotas mantêm o próprio formato de erro (ranking)', async () => {
    const response = await fetch(`${baseUrl}/api/ranking?limit=0`);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.error, 'Parâmetros de consulta inválidos.');
    assert.ok(Array.isArray(body.details));
    assert.equal(body.code, undefined);
  });

  test('banco indisponível: 503 PROFILE_QUERY_FAILED, sem chamar o Supabase', async () => {
    // Sem repo: usa o PostgreSQL de verdade, que o fakeEnv aponta para uma porta fechada.
    const supabase = createFakeSupabaseAuth(db);
    useDependencies({ supabase });

    const { status, body } = await register({ username: 'Sem_Banco', email: 'sembanco@example.com', password: PASSWORD });

    assert.equal(status, 503);
    assert.deepEqual(body, { error: GENERIC_ERROR, code: 'PROFILE_QUERY_FAILED' });
    assert.equal(supabase.signUpCalls.length, 0);
  });

  test('Supabase indisponível: 503 SUPABASE_UNAVAILABLE com o cliente real, sem conta criada', async () => {
    // Sem supabase: usa o cliente de verdade, que o fakeEnv aponta para uma porta fechada.
    useDependencies({ repo: memoryRepo() });

    const { status, body } = await register({ username: 'Sem_Auth', email: 'semauth@example.com', password: PASSWORD });

    assert.equal(status, 503);
    assert.deepEqual(body, { error: GENERIC_ERROR, code: 'SUPABASE_UNAVAILABLE' });
    assert.equal(await countAccounts('semauth@example.com'), 0);
  });

  test('erro inesperado: 500 INTERNAL_ERROR, com o detalhe só no log do servidor', async () => {
    const supabase = {
      auth: {
        signUp: async () => {
          throw new TypeError('detalhe interno do bug');
        }
      }
    };
    useDependencies({ supabase, repo: memoryRepo() });

    const { status, body, text } = await register({ username: 'Com_Bug', email: 'bug@example.com', password: PASSWORD });

    assert.equal(status, 500);
    assert.deepEqual(body, { error: GENERIC_ERROR, code: 'INTERNAL_ERROR' });
    assert.doesNotMatch(text, /detalhe interno/);
    assert.ok(logLines.some((line) => line.includes('detalhe interno do bug')));
  });
});

describe('documentação Swagger do cadastro', () => {
  test('documenta as respostas que o cadastro realmente devolve', () => {
    const operation = createSwaggerSpec(config).paths['/api/auth/register'].post;

    assert.deepEqual(Object.keys(operation.responses).sort(), ['201', '400', '409', '422', '429', '500', '502', '503']);

    const success = operation.responses[201].content['application/json'];
    assert.ok(success.schema.properties.usernameChanged);
    assert.equal(success.examples.nomeProvisorio.value.usernameChanged, true);

    const conflictCodes = Object.values(operation.responses[409].content['application/json'].examples)
      .map((example) => example.value.code)
      .sort();
    assert.deepEqual(conflictCodes, ['AUTH_USER_ALREADY_EXISTS', 'USERNAME_ALREADY_EXISTS']);
  });
});
