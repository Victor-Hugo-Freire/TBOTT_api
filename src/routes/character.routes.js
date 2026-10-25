import { registerRoute } from '../docs/catalog.js';
import { listCharactersController } from '../controller/characterController.js';

export const registerCharacterRoutes = (app) => {
  registerRoute({
    app,
    method: 'GET',
    path: '/api/characters',
    category: 'Personagens',
    description: 'Lista o catálogo público de personagens jogáveis, na ordem da tela de seleção.',
    auth: 'Pública',
    responses: {
      200: { description: 'Lista de personagens.' },
      503: { description: 'Banco de dados indisponível.' }
    },
    handler: listCharactersController
  });
};
