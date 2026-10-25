import { registerRoute } from '../docs/catalog.js';
import { registerUserController } from '../controller/authController.js';

// Formato dos erros do cadastro: { error, code, details? }.
const errorSchema = {
  type: 'object',
  properties: {
    error: { type: 'string', description: 'Mensagem em português. Em erros 5xx é sempre genérica.' },
    code: { type: 'string', description: 'Código fixo para o front-end tratar cada caso.' },
    details: {
      type: 'array',
      description: 'Só em INVALID_REGISTER_DATA: uma mensagem por regra violada.',
      items: {
        type: 'object',
        properties: {
          field: { type: 'string' },
          message: { type: 'string' }
        }
      }
    }
  }
};

const GENERIC_ERROR = 'Não foi possível concluir a operação no momento.';

// Resposta de erro com exemplos nomeados (aparecem numa lista no Swagger).
const errorResponse = (description, examples) => ({
  description,
  content: {
    'application/json': {
      schema: errorSchema,
      examples: Object.fromEntries(Object.entries(examples).map(([name, value]) => [name, { value }]))
    }
  }
});

const exampleUser = { id: '0b7f6c1e-4d2a-4b8e-9f3a-2c1d5e6f7a8b', email: 'jogador.teste@example.com' };

const registerResponseSchema = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['pending_email_confirmation', 'registered'] },
    requiresEmailConfirmation: { type: 'boolean' },
    usernameChanged: { type: 'boolean', description: 'true quando o nome pedido não foi mantido. Mostre sempre profile.username.' },
    user: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid' },
        email: { type: 'string' }
      }
    },
    profile: {
      type: 'object',
      properties: {
        id: { type: 'string', format: 'uuid', description: 'Igual a user.id.' },
        username: { type: 'string', description: 'Nome gravado no banco.' }
      }
    }
  }
};

export const registerAuthRoutes = (app) => {
  registerRoute({
    app,
    method: 'POST',
    path: '/api/auth/register',
    category: 'Autenticação',
    description: 'Cria a conta do jogador no Supabase Auth. O perfil (public.profiles) é criado pelo gatilho do banco na mesma transação, com o mesmo id do usuário. Com "Confirm email" ligado no Supabase, a conta fica pendente até o jogador clicar no link do e-mail. A API nunca devolve tokens: o login fica para outra rota.',
    auth: 'Pública',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['username', 'email', 'password'],
            properties: {
              username: {
                type: 'string',
                minLength: 3,
                maxLength: 20,
                pattern: '^[A-Za-z0-9_]+$',
                description: 'Nome único, sem diferenciar maiúsculas: 3 a 20 caracteres, só letras, números e underscore (_). Espaços nas pontas são removidos.'
              },
              email: {
                type: 'string',
                format: 'email',
                description: 'E-mail do jogador, usado na confirmação da conta e gravado em minúsculas. Troque o do exemplo por um seu: o Supabase recusa domínios de exemplo, como example.com.'
              },
              password: {
                type: 'string',
                minLength: 8,
                maxLength: 72,
                description: '8 a 72 caracteres, e não pode ser só espaços. Vai para o Supabase exatamente como foi digitada e nunca aparece em respostas ou logs.'
              }
            }
          },
          example: {
            username: 'jogador_123',
            email: 'jogador.teste@example.com',
            password: 'Senha-Teste-123'
          }
        }
      }
    },
    responses: {
      201: {
        description: 'Conta criada. status = pending_email_confirmation quando o Supabase exige confirmar o e-mail (o login só funciona depois do link); status = registered quando a confirmação está desligada. usernameChanged = true quando o nome pedido não foi mantido: outro cadastro o ocupou no mesmo instante e o banco gravou um nome provisório (jogador_...), ou o e-mail já tinha um cadastro pendente com outro nome.',
        content: {
          'application/json': {
            schema: registerResponseSchema,
            examples: {
              confirmacaoPendente: {
                value: {
                  status: 'pending_email_confirmation',
                  requiresEmailConfirmation: true,
                  usernameChanged: false,
                  user: exampleUser,
                  profile: { id: exampleUser.id, username: 'jogador_123' }
                }
              },
              nomeProvisorio: {
                value: {
                  status: 'pending_email_confirmation',
                  requiresEmailConfirmation: true,
                  usernameChanged: true,
                  user: exampleUser,
                  profile: { id: exampleUser.id, username: 'jogador_0b7f6c1e4d2a' }
                }
              },
              confirmacaoDesligada: {
                value: {
                  status: 'registered',
                  requiresEmailConfirmation: false,
                  usernameChanged: false,
                  user: exampleUser,
                  profile: { id: exampleUser.id, username: 'jogador_123' }
                }
              }
            }
          }
        }
      },
      400: errorResponse(
        'Dados inválidos (INVALID_REGISTER_DATA, com details por campo), JSON malformado (INVALID_JSON), e-mail recusado pelo Supabase (INVALID_EMAIL) ou cadastro recusado pelo Supabase por outro motivo (AUTH_REGISTRATION_FAILED; ex.: o SMTP padrão só envia e-mails para membros da organização). Nenhuma conta é criada.',
        {
          dadosInvalidos: {
            error: 'Dados de cadastro inválidos.',
            code: 'INVALID_REGISTER_DATA',
            details: [
              { field: 'email', message: 'E-mail inválido.' },
              { field: 'password', message: 'Senha deve ter pelo menos 8 caracteres.' }
            ]
          },
          jsonMalformado: { error: 'O corpo da requisição não é um JSON válido.', code: 'INVALID_JSON' },
          emailRecusado: { error: 'Endereço de e-mail inválido ou não aceito para cadastro.', code: 'INVALID_EMAIL' },
          cadastroRecusado: { error: 'Não foi possível concluir o cadastro no momento.', code: 'AUTH_REGISTRATION_FAILED' }
        }
      ),
      409: errorResponse(
        'USERNAME_ALREADY_EXISTS: nome já usado, sem diferenciar maiúsculas; é verificado antes de criar a conta, então nenhuma conta é criada. AUTH_USER_ALREADY_EXISTS: e-mail já cadastrado. Com "Confirm email" ligado o Supabase esconde essa informação de propósito; por decisão do projeto a API responde 409 mesmo assim, o que revela se um e-mail tem conta.',
        {
          nomeEmUso: { error: 'Nome de usuário já está em uso.', code: 'USERNAME_ALREADY_EXISTS' },
          emailCadastrado: { error: 'Este e-mail já está cadastrado.', code: 'AUTH_USER_ALREADY_EXISTS' }
        }
      ),
      422: errorResponse(
        'INVALID_PASSWORD: a senha passou nas regras da API, mas não na política de senha configurada no Supabase.',
        { senhaFraca: { error: 'A senha não atende aos requisitos de segurança.', code: 'INVALID_PASSWORD' } }
      ),
      429: errorResponse(
        'AUTH_RATE_LIMITED: limite de cadastros ou de envio de e-mails do Supabase atingido.',
        { limite: { error: 'Muitas tentativas em pouco tempo. Tente novamente mais tarde.', code: 'AUTH_RATE_LIMITED' } }
      ),
      500: errorResponse(
        'INTERNAL_ERROR: erro inesperado na API. O detalhe fica só no log do servidor.',
        { inesperado: { error: GENERIC_ERROR, code: 'INTERNAL_ERROR' } }
      ),
      502: errorResponse(
        'PROFILE_NOT_CREATED: a conta foi criada, mas o perfil não existe porque o gatilho on_auth_user_created não está instalado no banco (erro de configuração). AUTH_REGISTRATION_INCOMPLETE: o Supabase não devolveu o usuário.',
        { perfilAusente: { error: GENERIC_ERROR, code: 'PROFILE_NOT_CREATED' } }
      ),
      503: errorResponse(
        'Banco de dados (PROFILE_QUERY_FAILED) ou Supabase Auth (SUPABASE_UNAVAILABLE) indisponível, ou SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY não configuradas (SUPABASE_CONFIG_MISSING). Se o banco falhar logo depois do signUp, a conta pode já ter sido criada.',
        {
          bancoIndisponivel: { error: GENERIC_ERROR, code: 'PROFILE_QUERY_FAILED' },
          supabaseIndisponivel: { error: GENERIC_ERROR, code: 'SUPABASE_UNAVAILABLE' },
          configuracaoAusente: { error: GENERIC_ERROR, code: 'SUPABASE_CONFIG_MISSING' }
        }
      )
    },
    handler: registerUserController
  });
};
