import { registerRoute } from '../docs/catalog.js';
import { getProgressController, hasProgressController, saveProgressController } from '../controller/progressController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const errorSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    code: { type: 'string' },
    details: {
      type: 'array',
      items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } }
    }
  }
};

const errorResponse = (description, example) => ({
  description,
  content: { 'application/json': { schema: errorSchema, example } }
});

// Só um exemplo: o formato do progresso é decidido pelo jogo (TBOTT_web).
const progressExample = {
  characterId: 'tung-tung-sahur',
  andar: 1,
  sala: 'inicial',
  vida: 3,
  graos: 4,
  garfos: 1,
  itens: ['cafe-duplo']
};

export const registerProgressRoutes = (app) => {
  registerRoute({
    app,
    method: 'PUT',
    path: '/api/progress',
    category: 'Progresso',
    description: 'Salva ou substitui o progresso do jogador autenticado. Começar outra run substitui o progresso anterior; registrar o fim da run (POST /api/runs) o apaga. O conteúdo é livre e o campo userId do cliente é ignorado.',
    auth: 'Sessão: cookies tbott_access_token e tbott_refresh_token, gravados pelo login',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            description: 'Objeto JSON com o estado da run (ex.: personagem, andar, sala, vida, grãos, garfos e itens). Precisa ser um objeto, não uma lista, texto ou número.'
          },
          example: progressExample
        }
      }
    },
    responses: {
      200: {
        description: 'Progresso salvo ou atualizado com sucesso. A operação substitui a versão anterior do mesmo usuário.',
        content: {
          'application/json': {
            example: {
              exists: true,
              progress: progressExample
            }
          }
        }
      },
      400: errorResponse('INVALID_PROGRESS_DATA (o corpo é uma lista ou está vazio) ou INVALID_JSON (JSON malformado, texto, número ou null).', {
        error: 'Dados de progresso inválidos.',
        code: 'INVALID_PROGRESS_DATA',
        details: [{ field: 'request', message: 'Progresso deve ser um objeto JSON válido.' }]
      }),
      401: errorResponse('AUTH_SESSION_MISSING ou AUTH_SESSION_EXPIRED: faça login.', {
        error: 'Faça login para continuar.',
        code: 'AUTH_SESSION_MISSING'
      }),
      403: errorResponse('ORIGIN_NOT_ALLOWED: requisição de um site que não é o TBOTT_web (proteção contra CSRF).', {
        error: 'Origem não autorizada para esta operação.',
        code: 'ORIGIN_NOT_ALLOWED'
      }),
      503: errorResponse('PROGRESS_SAVE_FAILED ou banco indisponível.', {
        error: 'Não foi possível concluir a operação no momento.',
        code: 'PROGRESS_SAVE_FAILED'
      })
    },
    middlewares: [requireAuth],
    handler: saveProgressController
  });

  registerRoute({
    app,
    method: 'GET',
    path: '/api/progress',
    category: 'Progresso',
    description: 'Recupera o progresso salvo do jogador autenticado. Quando não existe, responde explicitamente com exists = false e progress = null.',
    auth: 'Sessão: cookies tbott_access_token e tbott_refresh_token, gravados pelo login',
    responses: {
      200: {
        description: 'Retorna o progresso salvo ou informa ausência dele.',
        content: {
          'application/json': {
            examples: {
              salvo: {
                value: {
                  exists: true,
                  progress: progressExample
                }
              },
              ausente: {
                value: {
                  exists: false,
                  progress: null
                }
              }
            }
          }
        }
      },
      401: errorResponse('AUTH_SESSION_MISSING ou AUTH_SESSION_EXPIRED: faça login.', {
        error: 'Faça login para continuar.',
        code: 'AUTH_SESSION_MISSING'
      }),
      503: errorResponse('PROGRESS_QUERY_FAILED ou banco indisponível.', {
        error: 'Não foi possível concluir a operação no momento.',
        code: 'PROGRESS_QUERY_FAILED'
      })
    },
    middlewares: [requireAuth],
    handler: getProgressController
  });

  registerRoute({
    app,
    method: 'GET',
    path: '/api/progress/exists',
    category: 'Progresso',
    description: 'Consulta se o jogador autenticado possui uma partida salva.',
    auth: 'Sessão: cookies tbott_access_token e tbott_refresh_token, gravados pelo login',
    responses: {
      200: {
        description: 'Informa se existe progresso salvo para o usuário atual.',
        content: {
          'application/json': {
            example: { exists: true }
          }
        }
      },
      401: errorResponse('AUTH_SESSION_MISSING ou AUTH_SESSION_EXPIRED: faça login.', {
        error: 'Faça login para continuar.',
        code: 'AUTH_SESSION_MISSING'
      }),
      503: errorResponse('PROGRESS_QUERY_FAILED ou banco indisponível.', {
        error: 'Não foi possível concluir a operação no momento.',
        code: 'PROGRESS_QUERY_FAILED'
      })
    },
    middlewares: [requireAuth],
    handler: hasProgressController
  });
};
