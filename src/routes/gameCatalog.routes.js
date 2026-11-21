import { registerRoute } from '../docs/catalog.js';
import { getGameCatalogController } from '../controller/gameCatalogController.js';
import { requireAuth } from '../middleware/requireAuth.js';

const errorSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    code: { type: 'string' }
  }
};

const errorResponse = (description, example) => ({
  description,
  content: { 'application/json': { schema: errorSchema, example } }
});

// Um registro de cada lista, só para a documentação mostrar o formato.
const catalogExample = {
  items: [{
    id: 'tiramisu',
    name: 'Tiramisu',
    description: 'Cada golpe que acerta deixa o golpe e o passo mais rápidos por alguns segundos.',
    type: 'passivo',
    rarity: 'incomum',
    effect: { trigger: 'golpe-acerta', attackSpeedBonus: 0.25, moveSpeedMultiplier: 1.2, bonusDurationMs: 2000 },
    roomTypes: ['loja'],
    price: 15,
    spritePath: '/sprites/items/tiramisu/tiramisu.png',
    iconPath: '/sprites/items/tiramisu/tiramisu-icone.png'
  }],
  enemies: [{
    id: 'pistacchio-sputacchio',
    name: 'Pistacchio Sputacchio',
    description: 'Abre a casca e cospe um caroço.',
    health: 6,
    damage: 1,
    speed: 90,
    behavior: 'atirar',
    minFloor: 1,
    spriteLegsPath: '/sprites/enemies/pistacchio-sputacchio/pistacchio-sputacchio-pernas.png',
    spriteBodyPath: '/sprites/enemies/pistacchio-sputacchio/pistacchio-sputacchio-tronco.png'
  }],
  bosses: [{
    id: 'bombardiro-crocodilo',
    name: 'Bombardiro Crocodilo',
    description: 'Marca o chão e bombardeia; pousa para abastecer.',
    health: 90,
    damage: 1,
    attacks: [{ id: 'atacando', name: 'Bombardeio', damage: 2 }],
    minFloor: 3,
    maxFloor: 4,
    spriteLegsPath: '/sprites/bosses/bombardiro-crocodilo/bombardiro-crocodilo-pernas.png',
    spriteBodyPath: '/sprites/bosses/bombardiro-crocodilo/bombardiro-crocodilo-tronco.png'
  }]
};

export const registerGameCatalogRoutes = (app) => {
  registerRoute({
    app,
    method: 'GET',
    path: '/api/catalog',
    category: 'Catálogo do jogo',
    description: 'Catálogo do jogo (exige login): todos os itens, inimigos e chefes de uma vez, para o jogo guardar no começo da partida. Vida em pontos (valor de referência do catálogo: o golpe básico tira 3), dano em meios corações e velocidade em unidades por segundo.',
    auth: 'Sessão: cookies tbott_access_token e tbott_refresh_token, gravados pelo login',
    responses: {
      200: {
        description: 'Listas de itens, inimigos e chefes.',
        content: { 'application/json': { example: catalogExample } }
      },
      401: errorResponse('AUTH_SESSION_MISSING ou AUTH_SESSION_EXPIRED: faça login.', {
        error: 'Faça login para continuar.',
        code: 'AUTH_SESSION_MISSING'
      }),
      503: errorResponse('CATALOG_QUERY_FAILED ou banco indisponível.', {
        error: 'Não foi possível concluir a operação no momento.',
        code: 'CATALOG_QUERY_FAILED'
      })
    },
    middlewares: [requireAuth],
    handler: getGameCatalogController
  });
};
