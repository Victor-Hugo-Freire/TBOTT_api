import { registerRoute } from '../docs/catalog.js';
import {
  getCurrentUserController,
  loginController,
  logoutController,
  registerUserController
} from '../controller/authController.js';
import { requireAuth } from '../middleware/requireAuth.js';

// Formato dos erros das rotas de autenticação: { error, code, details? }.
const errorSchema = {
  type: 'object',
  properties: {
    error: { type: 'string', description: 'Mensagem em português. Em erros 5xx é sempre genérica.' },
    code: { type: 'string', description: 'Código fixo para o front-end tratar cada caso.' },
    details: {
      type: 'array',
      description: 'Só nos erros de validação (INVALID_REGISTER_DATA e INVALID_LOGIN_DATA): uma mensagem por regra violada.',
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

// Resposta do login e do GET /api/auth/me: o mesmo formato de user e profile do cadastro.
const sessionUserSchema = {
  type: 'object',
  properties: {
    user: registerResponseSchema.properties.user,
    profile: registerResponseSchema.properties.profile
  }
};

const exampleSessionUser = {
  user: exampleUser,
  profile: { id: exampleUser.id, username: 'jogador_123' }
};

const SESSION_AUTH = 'Sessão: cookies tbott_access_token e tbott_refresh_token, gravados pelo login';

const sessionCookiesHeader = {
  'Set-Cookie': {
    description: 'tbott_access_token (validade = expires_in do Supabase, 1 hora no padrão) e tbott_refresh_token (30 dias). Os dois com HttpOnly, SameSite=Lax e Path=/api; Secure em produção. O navegador guarda e envia os cookies sozinho, e o JavaScript da página não consegue lê-los. O Swagger não mostra este cabeçalho: confira os cookies nas ferramentas do navegador (F12 > Application > Cookies).',
    schema: { type: 'string' }
  }
};

const originRejected = { error: 'Origem não autorizada para esta operação.', code: 'ORIGIN_NOT_ALLOWED' };
const rateLimited = { error: 'Muitas tentativas em pouco tempo. Tente novamente mais tarde.', code: 'AUTH_RATE_LIMITED' };

export const registerAuthRoutes = (app) => {
  registerRoute({
    app,
    method: 'POST',
    path: '/api/auth/register',
    category: 'Autenticação',
    description: 'Cria a conta do jogador no Supabase Auth. O perfil (public.profiles) é criado pelo gatilho do banco na mesma transação, com o mesmo id do usuário. Com "Confirm email" ligado no Supabase, a conta fica pendente até o jogador clicar no link do e-mail. O cadastro nunca devolve tokens nem inicia a sessão: para entrar, use POST /api/auth/login.',
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

  registerRoute({
    app,
    method: 'POST',
    path: '/api/auth/login',
    category: 'Autenticação',
    description: 'Entra com e-mail e senha (Supabase Auth) e inicia a sessão em dois cookies httpOnly: tbott_access_token e tbott_refresh_token. Os tokens nunca aparecem no JSON. O login é só por e-mail. Uma conta com a confirmação de e-mail pendente recebe 403 até o jogador abrir o link enviado no cadastro. No front-end, chame com fetch(..., { credentials: "include" }). No Swagger, os cookies ficam guardados se a página for aberta pelo mesmo endereço da API (http://localhost:8000/api-docs).',
    auth: 'Pública',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['email', 'password'],
            properties: {
              email: {
                type: 'string',
                format: 'email',
                description: 'E-mail da conta. Espaços nas pontas são removidos e as letras viram minúsculas, como no cadastro.'
              },
              password: {
                type: 'string',
                minLength: 1,
                maxLength: 72,
                description: 'Senha exatamente como foi cadastrada. Nunca aparece em respostas ou logs.'
              }
            }
          },
          example: {
            email: 'jogador.teste@example.com',
            password: 'Senha-Teste-123'
          }
        }
      }
    },
    responses: {
      200: {
        description: 'Login feito. Os cookies de sessão vêm no cabeçalho Set-Cookie; o corpo traz só o jogador e o perfil.',
        headers: sessionCookiesHeader,
        content: {
          'application/json': {
            schema: sessionUserSchema,
            example: exampleSessionUser
          }
        }
      },
      400: errorResponse(
        'Dados inválidos (INVALID_LOGIN_DATA, com details por campo), JSON malformado (INVALID_JSON) ou login recusado pelo Supabase por outro motivo (AUTH_LOGIN_FAILED). Nenhum cookie é gravado.',
        {
          dadosInvalidos: {
            error: 'Dados de login inválidos.',
            code: 'INVALID_LOGIN_DATA',
            details: [
              { field: 'email', message: 'E-mail inválido.' },
              { field: 'password', message: 'Senha é obrigatória.' }
            ]
          },
          jsonMalformado: { error: 'O corpo da requisição não é um JSON válido.', code: 'INVALID_JSON' },
          loginRecusado: { error: 'Não foi possível entrar no momento.', code: 'AUTH_LOGIN_FAILED' }
        }
      ),
      401: errorResponse(
        'INVALID_CREDENTIALS: e-mail ou senha incorretos. A resposta é a mesma quando o e-mail não tem conta, para não revelar quem está cadastrado.',
        { credenciaisInvalidas: { error: 'E-mail ou senha incorretos.', code: 'INVALID_CREDENTIALS' } }
      ),
      403: errorResponse(
        'EMAIL_NOT_CONFIRMED: senha correta, mas o e-mail ainda não foi confirmado (o Supabase só informa isso depois de conferir a senha). ORIGIN_NOT_ALLOWED: requisição feita por um site que não é o TBOTT_web (proteção contra CSRF).',
        {
          emailNaoConfirmado: { error: 'Confirme seu e-mail antes de entrar. Use o link enviado no cadastro.', code: 'EMAIL_NOT_CONFIRMED' },
          origemRecusada: originRejected
        }
      ),
      429: errorResponse('AUTH_RATE_LIMITED: limite de tentativas de login do Supabase atingido.', { limite: rateLimited }),
      500: errorResponse(
        'PROFILE_NOT_FOUND: a conta existe no Supabase Auth, mas não tem perfil (erro de configuração do banco); a sessão criada é encerrada e nenhum cookie é gravado. INTERNAL_ERROR: erro inesperado.',
        {
          perfilAusente: { error: GENERIC_ERROR, code: 'PROFILE_NOT_FOUND' },
          inesperado: { error: GENERIC_ERROR, code: 'INTERNAL_ERROR' }
        }
      ),
      503: errorResponse(
        'Supabase Auth (SUPABASE_UNAVAILABLE) ou banco de dados (PROFILE_QUERY_FAILED) indisponível, ou SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY não configuradas (SUPABASE_CONFIG_MISSING). Nenhum cookie é gravado.',
        {
          supabaseIndisponivel: { error: GENERIC_ERROR, code: 'SUPABASE_UNAVAILABLE' },
          bancoIndisponivel: { error: GENERIC_ERROR, code: 'PROFILE_QUERY_FAILED' }
        }
      )
    },
    handler: loginController
  });

  registerRoute({
    app,
    method: 'GET',
    path: '/api/auth/me',
    category: 'Autenticação',
    description: 'Jogador logado, para o card de usuário do front-end. Exige a sessão dos cookies; o navegador os envia sozinho (no front-end, use credentials: "include"). A sessão é conferida no Supabase Auth a cada chamada, então um logout vale na hora. Se o access token venceu, a API renova a sessão com o refresh token e devolve cookies novos nesta mesma resposta.',
    auth: SESSION_AUTH,
    responses: {
      200: {
        description: 'Jogador logado. Se a sessão foi renovada, a resposta também traz Set-Cookie com os tokens novos.',
        headers: sessionCookiesHeader,
        content: {
          'application/json': {
            schema: sessionUserSchema,
            example: exampleSessionUser
          }
        }
      },
      401: errorResponse(
        'AUTH_SESSION_MISSING: nenhum cookie de sessão; faça login. AUTH_SESSION_EXPIRED: sessão inválida, encerrada (logout) ou que não pôde ser renovada; a resposta apaga os cookies. O front-end pode tratar qualquer 401 como "jogador deslogado".',
        {
          semSessao: { error: 'Faça login para continuar.', code: 'AUTH_SESSION_MISSING' },
          sessaoExpirada: { error: 'Sua sessão expirou. Faça login novamente.', code: 'AUTH_SESSION_EXPIRED' }
        }
      ),
      429: errorResponse('AUTH_RATE_LIMITED: limite de renovações de sessão do Supabase atingido. Os cookies são mantidos.', { limite: rateLimited }),
      500: errorResponse(
        'PROFILE_NOT_FOUND: a sessão é válida, mas a conta não tem perfil (erro de configuração do banco). INTERNAL_ERROR: erro inesperado.',
        { perfilAusente: { error: GENERIC_ERROR, code: 'PROFILE_NOT_FOUND' } }
      ),
      503: errorResponse(
        'Supabase Auth (SUPABASE_UNAVAILABLE) ou banco de dados (PROFILE_QUERY_FAILED) indisponível. Os cookies são mantidos, porque a sessão pode continuar válida.',
        {
          supabaseIndisponivel: { error: GENERIC_ERROR, code: 'SUPABASE_UNAVAILABLE' },
          bancoIndisponivel: { error: GENERIC_ERROR, code: 'PROFILE_QUERY_FAILED' }
        }
      )
    },
    middlewares: [requireAuth],
    handler: getCurrentUserController
  });

  registerRoute({
    app,
    method: 'POST',
    path: '/api/auth/logout',
    category: 'Autenticação',
    description: 'Encerra no Supabase a sessão dos cookies (scope "local": os outros aparelhos do jogador continuam logados) e apaga os cookies. Se o access token já venceu, a API usa o refresh token só para conseguir encerrar a sessão. Responde 200 também sem cookies ou com a sessão já vencida, para o front-end sempre poder tratar o jogador como deslogado. Não precisa de corpo.',
    auth: 'Pública (encerra a sessão dos cookies, se houver)',
    responses: {
      200: {
        description: 'Sessão encerrada e cookies apagados (Set-Cookie vazio, com validade no passado). Se o Supabase estiver fora do ar, os cookies são apagados mesmo assim e a falha fica só no log.',
        headers: {
          'Set-Cookie': {
            description: 'tbott_access_token e tbott_refresh_token vazios, com Expires no passado e o mesmo Path=/api: o navegador os apaga.',
            schema: { type: 'string' }
          }
        },
        content: {
          'application/json': {
            schema: { type: 'object', properties: { status: { type: 'string', enum: ['logged_out'] } } },
            example: { status: 'logged_out' }
          }
        }
      },
      403: errorResponse(
        'ORIGIN_NOT_ALLOWED: requisição feita por um site que não é o TBOTT_web (proteção contra CSRF). Nada é alterado.',
        { origemRecusada: originRejected }
      ),
      500: errorResponse('INTERNAL_ERROR: erro inesperado. Os cookies são apagados mesmo assim.', { inesperado: { error: GENERIC_ERROR, code: 'INTERNAL_ERROR' } }),
      503: errorResponse(
        'SUPABASE_CONFIG_MISSING: SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY não configuradas. Os cookies são apagados mesmo assim.',
        { configuracaoAusente: { error: GENERIC_ERROR, code: 'SUPABASE_CONFIG_MISSING' } }
      )
    },
    handler: logoutController
  });
};
