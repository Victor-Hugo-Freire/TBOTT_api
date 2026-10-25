import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import WebSocket from 'ws';

import { registerUser, registerUserSchema } from '../src/service/authService.js';

const makeFetchResponse = (body, ok = true, status = 200) => ({
  ok,
  status,
  json: async () => body
});

describe('auth register validation', () => {
  test('aceita username, email e senha válidos e normaliza os dados', () => {
    const result = registerUserSchema.parse({
      username: ' Jogador_1 ',
      email: '  JOGADOR@example.com  ',
      password: 'senhaSegura123'
    });

    assert.deepEqual(result, {
      username: 'Jogador_1',
      email: 'jogador@example.com',
      password: 'senhaSegura123'
    });
  });

  test('rejeita username fora do padrão', () => {
    assert.throws(() => registerUserSchema.parse({
      username: 'jo ga dor',
      email: 'jogador@example.com',
      password: 'senhaSegura123'
    }));
  });

  test('rejeita senha curta', () => {
    assert.throws(() => registerUserSchema.parse({
      username: 'jogador',
      email: 'jogador@example.com',
      password: '123'
    }));
  });
});

describe('supabase client initialization', () => {
  test('inicializa o cliente com transporte ws no Node.js 20', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_key_test';
    delete process.env.SUPABASE_ANON_KEY;

    const uniqueId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const { getSupabaseClient } = await import(`../src/config/supabase.js?test=${uniqueId}`);
    const client = getSupabaseClient();

    assert.ok(client);
    assert.equal(client.realtime.transport, WebSocket);
    assert.equal(client.realtime.transport.name, 'WebSocket');
  });
});

describe('auth register service', () => {
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_key_test';
    delete process.env.SUPABASE_ANON_KEY;

    globalThis.fetch = async () => makeFetchResponse({
      user: { id: '11111111-1111-4111-8111-111111111111', email: 'jogador@example.com' },
      session: null
    });
  });

  test('cria a conta no Auth e informa que a confirmação de e-mail é necessária', async () => {
    const result = await registerUser({
      username: 'Jogador_1',
      email: 'jogador@example.com',
      password: 'senhaSegura123'
    }, {
      supabase: {
        auth: {
          signUp: async () => ({
            data: {
              user: { id: '11111111-1111-4111-8111-111111111111', email: 'jogador@example.com' },
              session: null
            },
            error: null
          })
        }
      },
      repo: {
        usernameExists: async () => false,
        findProfileById: async () => ({ id: '11111111-1111-4111-8111-111111111111', username: 'Jogador_1' })
      }
    });

    assert.equal(result.status, 'pending_email_confirmation');
    assert.equal(result.user.email, 'jogador@example.com');
    assert.equal(result.requiresEmailConfirmation, true);
    assert.equal(result.profile.username, 'Jogador_1');
  });

  test('retorna conflito quando o username já existe', async () => {
    await assert.rejects(
      () => registerUser({
        username: 'jogador',
        email: 'novo@example.com',
        password: 'senhaSegura123'
      }, {
        repo: {
          usernameExists: async () => true,
          findProfileById: async () => ({})
        }
      }),
      /Nome de usuário já está em uso\./
    );
  });

  test('rejeita quando o Supabase cria um perfil com username alternativo por concorrência', async () => {
    await assert.rejects(
      () => registerUser({
        username: 'jogador',
        email: 'novo2@example.com',
        password: 'senhaSegura123'
      }, {
        supabase: {
          auth: {
            signUp: async () => ({
              data: {
                user: { id: '22222222-2222-4222-8222-222222222222', email: 'novo2@example.com' },
                session: null
              },
              error: null
            })
          }
        },
        repo: {
          usernameExists: async () => false,
          findProfileById: async () => ({ id: '22222222-2222-4222-8222-222222222222', username: 'jogador_abc123' })
        }
      }),
      /Nome de usuário já está em uso\./
    );
  });

  test('rejeita quando o perfil não foi gerado após o cadastro no Auth', async () => {
    await assert.rejects(
      () => registerUser({
        username: 'jogador3',
        email: 'novo3@example.com',
        password: 'senhaSegura123'
      }, {
        supabase: {
          auth: {
            signUp: async () => ({
              data: {
                user: { id: '33333333-3333-4333-8333-333333333333', email: 'novo3@example.com' },
                session: null
              },
              error: null
            })
          }
        },
        repo: {
          usernameExists: async () => false,
          findProfileById: async () => null
        }
      }),
      /perfil não foi gerado|Cadastro concluído no Auth/i
    );
  });

  test('converte erro do Supabase em resposta padronizada', async () => {
    await assert.rejects(
      () => registerUser({
        username: 'jogador',
        email: 'jogador@example.com',
        password: 'senhaSegura123'
      }, {
        supabase: {
          auth: {
            signUp: async () => ({
              data: null,
              error: { message: 'User already registered', status: 422 }
            })
          }
        },
        repo: {
          usernameExists: async () => false,
          findProfileById: async () => null
        }
      }),
      /já está cadastrado|não foi possível concluir o cadastro/i
    );
  });

  test('transforma falha de consulta ao perfil em AppError em vez de 500 genérico', async () => {
    await assert.rejects(
      () => registerUser({
        username: 'novo_usuario',
        email: 'novo_usuario@example.com',
        password: 'senhaSegura123'
      }, {
        repo: {
          usernameExists: async () => {
            throw new Error('column "public.profiles" does not exist');
          },
          findProfileById: async () => null
        }
      }),
      (error) => {
        assert.equal(error?.statusCode, 503);
        assert.equal(error?.code, 'PROFILE_CHECK_FAILED');
        return true;
      }
    );
  });

  test('mapeia email_address_invalid como erro de e-mail inválido', async () => {
    await assert.rejects(
      () => registerUser({
        username: 'novo_email',
        email: 'usuario@exemplo.com',
        password: 'senhaSegura123'
      }, {
        supabase: {
          auth: {
            signUp: async () => ({
              data: null,
              error: { code: 'email_address_invalid', status: 400, message: 'Email address is invalid' }
            })
          }
        },
        repo: {
          usernameExists: async () => false,
          findProfileById: async () => null
        }
      }),
      (error) => {
        assert.equal(error?.statusCode, 400);
        assert.equal(error?.code, 'INVALID_EMAIL');
        assert.equal(error?.message, 'Endereço de e-mail inválido ou não aceito para cadastro.');
        return true;
      }
    );
  });

  test('mapeia e-mail já cadastrado como conflito', async () => {
    await assert.rejects(
      () => registerUser({
        username: 'novo_usuario_2',
        email: 'existente@example.com',
        password: 'senhaSegura123'
      }, {
        supabase: {
          auth: {
            signUp: async () => ({
              data: null,
              error: { code: 'user_already_exists', status: 409, message: 'User already registered' }
            })
          }
        },
        repo: {
          usernameExists: async () => false,
          findProfileById: async () => null
        }
      }),
      (error) => {
        assert.equal(error?.statusCode, 409);
        assert.equal(error?.code, 'AUTH_USER_ALREADY_EXISTS');
        return true;
      }
    );
  });

  test('prioriza o código técnico do Supabase mesmo quando o status HTTP não bate com o cenário', async () => {
    await assert.rejects(
      () => registerUser({
        username: 'email_estranho',
        email: 'usuario@dominio.com',
        password: 'senhaSegura123'
      }, {
        supabase: {
          auth: {
            signUp: async () => ({
              data: null,
              error: { code: 'email_address_invalid', status: 422, message: 'Email address is invalid' }
            })
          }
        },
        repo: {
          usernameExists: async () => false,
          findProfileById: async () => null
        }
      }),
      (error) => {
        assert.equal(error?.statusCode, 400);
        assert.equal(error?.code, 'INVALID_EMAIL');
        return true;
      }
    );
  });

  test('mapeia senha inválida retornada pelo Supabase', async () => {
    await assert.rejects(
      () => registerUser({
        username: 'senha_invalida',
        email: 'segura@example.com',
        password: 'senhaSegura123'
      }, {
        supabase: {
          auth: {
            signUp: async () => ({
              data: null,
              error: { code: 'weak_password', status: 422, message: 'Password is too weak' }
            })
          }
        },
        repo: {
          usernameExists: async () => false,
          findProfileById: async () => null
        }
      }),
      (error) => {
        assert.equal(error?.statusCode, 422);
        assert.equal(error?.code, 'INVALID_PASSWORD');
        return true;
      }
    );
  });

  test('mapeia limite de requisições como rate limit', async () => {
    await assert.rejects(
      () => registerUser({
        username: 'limite_1',
        email: 'limite@example.com',
        password: 'senhaSegura123'
      }, {
        supabase: {
          auth: {
            signUp: async () => ({
              data: null,
              error: { code: 'over_request_rate_limit', status: 429, message: 'Rate limit exceeded' }
            })
          }
        },
        repo: {
          usernameExists: async () => false,
          findProfileById: async () => null
        }
      }),
      (error) => {
        assert.equal(error?.statusCode, 429);
        assert.equal(error?.code, 'AUTH_RATE_LIMITED');
        return true;
      }
    );
  });

  test('mapeia indisponibilidade do Supabase como 503', async () => {
    await assert.rejects(
      () => registerUser({
        username: 'supabase_off',
        email: 'off@example.com',
        password: 'senhaSegura123'
      }, {
        supabase: {
          auth: {
            signUp: async () => ({
              data: null,
              error: { code: 'service_unavailable', status: 503, message: 'Service temporarily unavailable' }
            })
          }
        },
        repo: {
          usernameExists: async () => false,
          findProfileById: async () => null
        }
      }),
      (error) => {
        assert.equal(error?.statusCode, 503);
        assert.equal(error?.code, 'SUPABASE_UNAVAILABLE');
        return true;
      }
    );
  });

  test('retorna PROFILE_NOT_CREATED quando o Auth cria o usuário mas o perfil demora a aparecer', async () => {
    let calls = 0;

    await assert.rejects(
      () => registerUser({
        username: 'perfil_lento',
        email: 'lento@example.com',
        password: 'senhaSegura123'
      }, {
        supabase: {
          auth: {
            signUp: async () => ({
              data: {
                user: { id: '44444444-4444-4444-8444-444444444444', email: 'lento@example.com' },
                session: null
              },
              error: null
            })
          }
        },
        repo: {
          usernameExists: async () => false,
          findProfileById: async () => {
            calls += 1;
            return null;
          }
        }
      }),
      (error) => {
        assert.equal(error?.statusCode, 502);
        assert.equal(error?.code, 'PROFILE_NOT_CREATED');
        assert.equal(calls, 3);
        return true;
      }
    );
  });
});
