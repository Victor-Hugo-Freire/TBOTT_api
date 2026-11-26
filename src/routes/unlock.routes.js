import { registerRoute } from '../docs/catalog.js';
import { createUnlockController, listUnlocksController } from '../controller/unlockController.js';
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

const SESSION_AUTH = 'Sessão: cookies tbott_access_token e tbott_refresh_token, gravados pelo login';

const unlockExample = {
  characterId: 'tung-tung-sabor',
  unlockedAt: '2026-11-26T20:33:42.947Z'
};

const unauthorized = errorResponse('AUTH_SESSION_MISSING ou AUTH_SESSION_EXPIRED: faça login.', {
  error: 'Faça login para continuar.',
  code: 'AUTH_SESSION_MISSING'
});

export const registerUnlockRoutes = (app) => {
  registerRoute({
    app,
    method: 'GET',
    path: '/api/unlocks',
    category: 'Desbloqueios',
    description: 'Lista os personagens que o jogador logado já liberou (o Tung Tung Sahur, que começa liberado, não entra aqui: veja startsUnlocked em GET /api/characters). O jogador é o da sessão (cookies).',
    auth: SESSION_AUTH,
    responses: {
      200: {
        description: 'Personagens liberados, do mais antigo para o mais novo.',
        content: { 'application/json': { example: { unlocks: [unlockExample] } } }
      },
      401: unauthorized,
      503: errorResponse('UNLOCK_QUERY_FAILED ou banco/Supabase indisponível.', {
        error: 'Não foi possível concluir a operação no momento.',
        code: 'UNLOCK_QUERY_FAILED'
      })
    },
    middlewares: [requireAuth],
    handler: listUnlocksController
  });

  registerRoute({
    app,
    method: 'POST',
    path: '/api/unlocks',
    category: 'Desbloqueios',
    description: 'Libera um personagem para o jogador logado, para sempre. O jogador é o da sessão (cookies): a API ignora qualquer id enviado no corpo. Liberar de novo o mesmo personagem não duplica: responde 200 com created = false. A API não tem como conferir se o jogador pegou o Elixir Elétrico ou venceu o jogo de verdade.',
    auth: SESSION_AUTH,
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['characterId'],
            properties: {
              characterId: { type: 'string', description: 'Id do personagem liberado (GET /api/characters). Ex.: tung-tung-sabor.' }
            }
          },
          example: { characterId: 'tung-tung-sabor' }
        }
      }
    },
    responses: {
      201: {
        description: 'Personagem liberado agora.',
        content: { 'application/json': { example: { unlock: unlockExample, created: true } } }
      },
      200: {
        description: 'O personagem já estava liberado: nada foi duplicado.',
        content: { 'application/json': { example: { unlock: unlockExample, created: false } } }
      },
      400: errorResponse('INVALID_UNLOCK_DATA (com details por campo) ou INVALID_JSON.', {
        error: 'Dados do desbloqueio inválidos.',
        code: 'INVALID_UNLOCK_DATA',
        details: [{ field: 'characterId', message: 'Personagem é obrigatório.' }]
      }),
      401: unauthorized,
      403: errorResponse('ORIGIN_NOT_ALLOWED: requisição de um site que não é o TBOTT_web (proteção contra CSRF).', {
        error: 'Origem não autorizada para esta operação.',
        code: 'ORIGIN_NOT_ALLOWED'
      }),
      422: errorResponse('CHARACTER_NOT_FOUND: o personagem não existe no catálogo.', {
        error: 'Personagem não encontrado.',
        code: 'CHARACTER_NOT_FOUND'
      }),
      503: errorResponse('UNLOCK_SAVE_FAILED ou banco/Supabase indisponível.', {
        error: 'Não foi possível concluir a operação no momento.',
        code: 'UNLOCK_SAVE_FAILED'
      })
    },
    middlewares: [requireAuth],
    handler: createUnlockController
  });
};
