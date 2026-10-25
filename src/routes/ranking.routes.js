import { registerRoute } from '../docs/catalog.js';
import { listRankingController } from '../controller/rankingController.js';
import { RANKING_DEFAULT_LIMIT, RANKING_MAX_LIMIT } from '../service/rankingService.js';

export const registerRankingRoutes = (app) => {
  registerRoute({
    app,
    method: 'GET',
    path: '/api/ranking',
    category: 'Ranking',
    description: 'Ranking público: melhor tempo de cada jogador em runs vencidas, do menor para o maior. Duração em milissegundos.',
    auth: 'Pública',
    parameters: [
      {
        name: 'limit',
        in: 'query',
        required: false,
        description: `Quantidade de posições (1 a ${RANKING_MAX_LIMIT}). Padrão: ${RANKING_DEFAULT_LIMIT}.`,
        schema: { type: 'integer', minimum: 1, maximum: RANKING_MAX_LIMIT }
      },
      {
        name: 'offset',
        in: 'query',
        required: false,
        description: 'Quantas posições pular (paginação). Padrão: 0.',
        schema: { type: 'integer', minimum: 0 }
      }
    ],
    responses: {
      200: { description: 'Ranking ordenado pelo menor tempo.' },
      400: { description: 'Parâmetros limit/offset inválidos.' },
      503: { description: 'Banco de dados indisponível.' }
    },
    handler: listRankingController
  });
};
