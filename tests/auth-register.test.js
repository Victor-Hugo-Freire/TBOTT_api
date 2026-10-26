import './helpers/fakeEnv.js';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { inspect } from 'node:util';
import WebSocket from 'ws';

import { createSupabaseClient } from '../src/config/supabase.js';
import { registerUser, registerUserSchema } from '../src/service/authService.js';
import { AppError } from '../src/utils/httpError.js';

const PASSWORD = 'Senha-Teste-123';
const USER_ID = '11111111-1111-4111-8111-111111111111';

const validData = (overrides = {}) => ({
  username: 'Jogador_1',
  email: 'jogador@example.com',
  password: PASSWORD,
  ...overrides
});

// Mensagens de validação no formato "campo: mensagem".
const validationMessages = (input) => {
  const result = registerUserSchema.safeParse(input);
  assert.equal(result.success, false, 'os dados deveriam ser inválidos');

  return result.error.issues.map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`);
};

// Dependências falsas do service. Guardam as chamadas para os testes conferirem.
const fakeContext = ({ signUpResult, existingProfile = null, profile = null } = {}) => {
  const calls = { signUp: [], findProfileById: [] };

  return {
    calls,
    supabase: {
      auth: {
        signUp: async (credentials) => {
          calls.signUp.push(credentials);
          return typeof signUpResult === 'function' ? signUpResult(credentials) : signUpResult;
        }
      }
    },
    repo: {
      usernameExists: async () => existingProfile,
      findProfileById: async (id) => {
        calls.findProfileById.push(id);
        return profile;
      }
    }
  };
};

const newUser = { id: USER_ID, email: 'jogador@example.com', identities: [{ provider: 'email' }] };
const signUpOk = (session = null, user = newUser) => ({ data: { user, session }, error: null });
const signUpError = (error) => ({ data: { user: null, session: null }, error });
const profileNamed = (username) => ({ id: USER_ID, username });

// Confere o erro completo (status, código e mensagem), não só que algum erro aconteceu.
const isAppError = (expected) => (error) => {
  assert.ok(error instanceof AppError, `esperado AppError, recebido ${error?.name}: ${error?.message}`);
  assert.equal(error.statusCode, expected.statusCode);
  assert.equal(error.code, expected.code);

  if (expected.message) {
    assert.equal(error.message, expected.message);
  }

  return true;
};

describe('validação do cadastro', () => {
  test('aceita dados válidos: tira espaços do nome, normaliza o e-mail e não mexe na senha', () => {
    const result = registerUserSchema.parse({
      username: ' Jogador_1 ',
      email: '  JOGADOR@Example.COM  ',
      password: '  Senha-Teste-123  '
    });

    assert.deepEqual(result, {
      username: 'Jogador_1',
      email: 'jogador@example.com',
      password: '  Senha-Teste-123  '
    });
  });

  test('aceita senhas nos limites de 8 e 72 caracteres', () => {
    assert.equal(registerUserSchema.parse(validData({ password: 'a'.repeat(8) })).password.length, 8);
    assert.equal(registerUserSchema.parse(validData({ password: 'a'.repeat(72) })).password.length, 72);
  });

  test('descarta campos que não fazem parte do cadastro', () => {
    const result = registerUserSchema.parse({ ...validData(), role: 'admin' });

    assert.deepEqual(Object.keys(result).sort(), ['email', 'password', 'username']);
  });

  test('campos ausentes geram mensagens em português', () => {
    assert.deepEqual(validationMessages({}), [
      'username: Nome de usuário é obrigatório.',
      'email: E-mail é obrigatório.',
      'password: Senha é obrigatória.'
    ]);
  });

  test('tipos errados geram mensagens em português', () => {
    assert.deepEqual(validationMessages({ username: 123, email: true, password: null }), [
      'username: Nome de usuário deve ser um texto.',
      'email: E-mail deve ser um texto.',
      'password: Senha deve ser um texto.'
    ]);
  });

  test('corpo que não é um objeto JSON é recusado', () => {
    for (const body of [undefined, [], 'texto']) {
      assert.deepEqual(validationMessages(body), ['request: O corpo da requisição deve ser um objeto JSON.']);
    }
  });

  test('nome de usuário inválido: uma mensagem clara para cada caso', () => {
    const cases = [
      ['   ', 'Nome de usuário deve ter pelo menos 3 caracteres.'],
      ['ab', 'Nome de usuário deve ter pelo menos 3 caracteres.'],
      ['a'.repeat(21), 'Nome de usuário deve ter no máximo 20 caracteres.'],
      ['jo ga dor', 'Nome de usuário só pode conter letras, números e underscore (_).'],
      ['Jogadór', 'Nome de usuário só pode conter letras, números e underscore (_).']
    ];

    for (const [username, message] of cases) {
      assert.deepEqual(validationMessages(validData({ username })), [`username: ${message}`], JSON.stringify(username));
    }
  });

  test('e-mail inválido', () => {
    for (const email of ['jogador.gmail.com', 'a@b', '   ']) {
      assert.deepEqual(validationMessages(validData({ email })), ['email: E-mail inválido.'], JSON.stringify(email));
    }
  });

  test('senha fora das regras: mínimo, máximo e só espaços', () => {
    const cases = [
      ['1234567', 'Senha deve ter pelo menos 8 caracteres.'],
      ['   ', 'Senha deve ter pelo menos 8 caracteres.'],
      ['a'.repeat(73), 'Senha deve ter no máximo 72 caracteres.'],
      [' '.repeat(8), 'Senha não pode conter apenas espaços.'],
      ['\t'.repeat(10), 'Senha não pode conter apenas espaços.']
    ];

    for (const [password, message] of cases) {
      assert.deepEqual(validationMessages(validData({ password })), [`password: ${message}`], `senha com ${password.length} caracteres`);
    }
  });
});

describe('cliente do Supabase', () => {
  test('usa o transporte ws (necessário no Node.js 20, que não tem WebSocket nativo)', () => {
    assert.equal(createSupabaseClient().realtime.transport, WebSocket);
  });
});

describe('cadastro no service', () => {
  test('cadastro válido com confirmação de e-mail: chama o signUp uma vez e devolve o perfil do gatilho', async () => {
    const context = fakeContext({ signUpResult: signUpOk(), profile: profileNamed('Jogador_1') });

    const result = await registerUser(validData(), context);

    assert.deepEqual(result, {
      status: 'pending_email_confirmation',
      requiresEmailConfirmation: true,
      usernameChanged: false,
      user: { id: USER_ID, email: 'jogador@example.com' },
      profile: { id: USER_ID, username: 'Jogador_1' }
    });
    assert.deepEqual(context.calls.signUp, [{
      email: 'jogador@example.com',
      password: PASSWORD,
      options: { data: { username: 'Jogador_1' } }
    }]);
    assert.deepEqual(context.calls.findProfileById, [USER_ID]);
  });

  test('confirmação de e-mail desligada: status registered e nenhum token na resposta', async () => {
    const session = { access_token: 'token-falso', refresh_token: 'refresh-falso' };
    const context = fakeContext({ signUpResult: signUpOk(session), profile: profileNamed('Jogador_1') });

    const result = await registerUser(validData(), context);

    assert.equal(result.status, 'registered');
    assert.equal(result.requiresEmailConfirmation, false);
    assert.doesNotMatch(JSON.stringify(result), /token/);
  });

  test('nome já usado: 409 antes de chamar o Supabase', async () => {
    const context = fakeContext({ existingProfile: { id: 'outro-id', username: 'jogador_1' } });

    await assert.rejects(registerUser(validData(), context), isAppError({
      statusCode: 409,
      code: 'USERNAME_ALREADY_EXISTS',
      message: 'Nome de usuário já está em uso.'
    }));
    assert.equal(context.calls.signUp.length, 0);
  });

  test('falha ao verificar o nome: 503 sem chamar o Supabase', async () => {
    const context = fakeContext();
    context.repo.usernameExists = async () => {
      throw new Error('connection terminated unexpectedly');
    };

    await assert.rejects(registerUser(validData(), context), isAppError({ statusCode: 503, code: 'PROFILE_CHECK_FAILED' }));
    assert.equal(context.calls.signUp.length, 0);
  });

  test('erro do repositório chega ao controller sem ser trocado', async () => {
    const context = fakeContext();
    context.repo.usernameExists = async () => {
      throw new AppError({ statusCode: 503, code: 'PROFILE_QUERY_FAILED', message: 'Banco fora do ar.' });
    };

    await assert.rejects(registerUser(validData(), context), isAppError({ statusCode: 503, code: 'PROFILE_QUERY_FAILED' }));
  });
});

describe('E1: e-mail já cadastrado', () => {
  test('confirmação ligada (usuário falso com identities vazio): 409 sem procurar perfil pelo id falso', async () => {
    const fakeUser = { id: '99999999-9999-4999-8999-999999999999', email: 'jogador@example.com', identities: [] };
    const context = fakeContext({ signUpResult: signUpOk(null, fakeUser) });

    await assert.rejects(registerUser(validData(), context), isAppError({
      statusCode: 409,
      code: 'AUTH_USER_ALREADY_EXISTS',
      message: 'Este e-mail já está cadastrado.'
    }));
    assert.equal(context.calls.signUp.length, 1);
    assert.deepEqual(context.calls.findProfileById, []);
  });

  test('confirmação desligada (erro user_already_exists do Supabase): 409', async () => {
    const context = fakeContext({
      signUpResult: signUpError({ code: 'user_already_exists', status: 422, message: 'User already registered' })
    });

    await assert.rejects(registerUser(validData(), context), isAppError({
      statusCode: 409,
      code: 'AUTH_USER_ALREADY_EXISTS',
      message: 'Este e-mail já está cadastrado.'
    }));
    assert.deepEqual(context.calls.findProfileById, []);
  });

  test('erro de e-mail repetido sem código (servidor antigo): reconhecido pela mensagem, 409', async () => {
    const context = fakeContext({ signUpResult: signUpError({ status: 422, message: 'User already registered' }) });

    await assert.rejects(registerUser(validData(), context), isAppError({ statusCode: 409, code: 'AUTH_USER_ALREADY_EXISTS' }));
  });

  test('usuário sem a lista identities não é confundido com e-mail repetido', async () => {
    const userWithoutIdentities = { id: USER_ID, email: 'jogador@example.com' };
    const context = fakeContext({ signUpResult: signUpOk(null, userWithoutIdentities), profile: profileNamed('Jogador_1') });

    const result = await registerUser(validData(), context);

    assert.equal(result.user.id, USER_ID);
    assert.deepEqual(context.calls.findProfileById, [USER_ID]);
  });
});

describe('E2: nome ocupado depois da verificação', () => {
  test('o banco gravou um nome provisório: sucesso com o nome real e usernameChanged = true', async () => {
    const context = fakeContext({ signUpResult: signUpOk(), profile: profileNamed('jogador_111111111111') });

    const result = await registerUser(validData(), context);

    assert.equal(result.status, 'pending_email_confirmation');
    assert.equal(result.usernameChanged, true);
    assert.deepEqual(result.profile, { id: USER_ID, username: 'jogador_111111111111' });
    assert.equal(result.profile.id, result.user.id);
  });

  test('o mesmo nome com outra capitalização não conta como troca (usernameChanged = false)', async () => {
    const context = fakeContext({ signUpResult: signUpOk(), profile: profileNamed('jogador_1') });

    const result = await registerUser(validData({ username: 'Jogador_1' }), context);

    assert.equal(result.usernameChanged, false);
  });
});

describe('falhas depois do signUp', () => {
  test('perfil ausente (gatilho não instalado): 502 com uma única leitura, sem novas tentativas', async () => {
    const context = fakeContext({ signUpResult: signUpOk(), profile: null });

    await assert.rejects(registerUser(validData(), context), isAppError({ statusCode: 502, code: 'PROFILE_NOT_CREATED' }));
    assert.deepEqual(context.calls.findProfileById, [USER_ID]);
  });

  test('Supabase não devolveu o usuário: 502', async () => {
    const context = fakeContext({ signUpResult: { data: { user: null, session: null }, error: null } });

    await assert.rejects(registerUser(validData(), context), isAppError({ statusCode: 502, code: 'AUTH_REGISTRATION_INCOMPLETE' }));
  });

  test('erro de programação não é disfarçado de indisponibilidade do Supabase', async () => {
    const bug = new TypeError('bug simulado');
    const context = fakeContext({
      signUpResult: () => {
        throw bug;
      }
    });

    await assert.rejects(registerUser(validData(), context), (error) => error === bug);
  });
});

describe('erros devolvidos pelo Supabase', () => {
  const cases = [
    ['e-mail recusado', { code: 'email_address_invalid', status: 400, message: 'Email address is invalid' }, 400, 'INVALID_EMAIL'],
    ['e-mail recusado com outro status (vale o código)', { code: 'email_address_invalid', status: 422, message: 'Email address is invalid' }, 400, 'INVALID_EMAIL'],
    ['senha fraca para a política do Supabase', { code: 'weak_password', status: 422, message: 'Password is too weak' }, 422, 'INVALID_PASSWORD'],
    ['limite de cadastros', { code: 'over_request_rate_limit', status: 429, message: 'Request rate limit reached' }, 429, 'AUTH_RATE_LIMITED'],
    ['limite de envio de e-mails', { code: 'over_email_send_rate_limit', status: 429, message: 'Email rate limit exceeded' }, 429, 'AUTH_RATE_LIMITED'],
    ['Supabase fora do ar', { code: 'service_unavailable', status: 503, message: 'Service temporarily unavailable' }, 503, 'SUPABASE_UNAVAILABLE'],
    ['falha interna do Supabase', { code: 'unexpected_failure', status: 500, message: 'Database error saving new user' }, 503, 'SUPABASE_UNAVAILABLE'],
    ['outro motivo (ex.: SMTP padrão recusa o endereço)', { code: 'email_address_not_authorized', status: 400, message: 'Email address not authorized' }, 400, 'AUTH_REGISTRATION_FAILED']
  ];

  for (const [name, supabaseError, statusCode, code] of cases) {
    test(`${name}: ${statusCode} ${code}`, async () => {
      const context = fakeContext({ signUpResult: signUpError(supabaseError) });

      await assert.rejects(registerUser(validData(), context), isAppError({ statusCode, code }));
      assert.deepEqual(context.calls.findProfileById, []);
    });
  }

  test('cliente real com o Supabase inacessível: 503 SUPABASE_UNAVAILABLE', async (t) => {
    // Sem context.supabase: usa o cliente de verdade, que o fakeEnv aponta para uma porta fechada.
    t.mock.method(console, 'error', () => {});
    const { repo } = fakeContext();

    await assert.rejects(registerUser(validData(), { repo }), isAppError({ statusCode: 503, code: 'SUPABASE_UNAVAILABLE' }));
  });
});

describe('logs do cadastro', () => {
  test('a senha e o e-mail não aparecem nos logs, nem no sucesso nem nos erros', async (t) => {
    const lines = [];
    for (const level of ['log', 'info', 'warn', 'error']) {
      t.mock.method(console, level, (...args) => {
        lines.push(args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { depth: 5 }))).join(' '));
      });
    }

    const failingRepo = fakeContext();
    failingRepo.repo.usernameExists = async () => {
      throw new Error('falha no banco');
    };

    await registerUser(validData(), fakeContext({ signUpResult: signUpOk(), profile: profileNamed('Jogador_1') }));
    await registerUser(validData(), fakeContext({ signUpResult: signUpError({ code: 'weak_password', status: 422 }) })).catch(() => {});
    await registerUser(validData(), fakeContext({ signUpResult: signUpOk(null, { id: 'x', identities: [] }) })).catch(() => {});
    await registerUser(validData(), failingRepo).catch(() => {});

    assert.ok(lines.length > 0, 'o cadastro deveria ter registrado as etapas');
    for (const line of lines) {
      assert.ok(!line.includes(PASSWORD), `senha no log: ${line}`);
      assert.ok(!line.includes('jogador@example.com'), `e-mail no log: ${line}`);
    }
  });
});
