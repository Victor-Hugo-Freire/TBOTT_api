import { registerRoute } from '../docs/catalog.js';
import { createRunController } from '../controller/runController.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { RUN_MAX_DURATION_MS } from '../service/runService.js';

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

export const registerRunRoutes = (app) => {
  registerRoute({
    app,
    method: 'POST',
    path: '/api/runs',
    category: 'Partidas',
    description: 'Registra o resultado de uma partida encerrada do jogador logado. O jogador é o da sessão (cookies): a API ignora qualquer id enviado no corpo. Só runs com status "victory" (todas as fases completas, vivo) entram no ranking; o ranking mostra o menor tempo de cada jogador.',
    auth: 'Sessão: cookies tbott_access_token e tbott_refresh_token, gravados pelo login',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['characterId', 'durationMs', 'status'],
            properties: {
              characterId: { type: 'string', description: 'Id do personagem usado (GET /api/characters). Ex.: tung-tung-sahur.' },
              durationMs: { type: 'integer', minimum: 1, maximum: RUN_MAX_DURATION_MS, description: 'Tempo total da partida em milissegundos.' },
              status: { type: 'string', enum: ['victory', 'defeat'], description: 'victory = completou todas as fases vivo; defeat = morreu.' }
            }
          },
          example: { characterId: 'tung-tung-sahur', durationMs: 650000, status: 'victory' }
        }
      }
    },
    responses: {
      201: {
        description: 'Partida registrada.',
        content: {
          'application/json': {
            example: {
              run: {
                id: 'fe0560c2-c4c6-4f73-8d04-86cf1017666d',
                characterId: 'tung-tung-sahur',
                status: 'victory',
                durationMs: 650000,
                finishedAt: '2026-10-31T20:33:42.947Z'
              }
            }
          }
        }
      },
      400: errorResponse('INVALID_RUN_DATA (com details por campo) ou INVALID_JSON.', {
        error: 'Dados da partida inválidos.',
        code: 'INVALID_RUN_DATA',
        details: [{ field: 'durationMs', message: 'Tempo deve ser maior que zero.' }]
      }),
      401: errorResponse('AUTH_SESSION_MISSING ou AUTH_SESSION_EXPIRED: faça login.', {
        error: 'Faça login para continuar.',
        code: 'AUTH_SESSION_MISSING'
      }),
      403: errorResponse('ORIGIN_NOT_ALLOWED: requisição de um site que não é o TBOTT_web (proteção contra CSRF).', {
        error: 'Origem não autorizada para esta operação.',
        code: 'ORIGIN_NOT_ALLOWED'
      }),
      422: errorResponse('CHARACTER_NOT_FOUND: o personagem não existe no catálogo.', {
        error: 'Personagem não encontrado.',
        code: 'CHARACTER_NOT_FOUND'
      }),
      503: errorResponse('RUN_SAVE_FAILED ou banco/Supabase indisponível.', {
        error: 'Não foi possível concluir a operação no momento.',
        code: 'RUN_SAVE_FAILED'
      })
    },
    middlewares: [requireAuth],
    handler: createRunController
  });
};
