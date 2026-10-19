import { registerRoute } from '../docs/catalog.js';
import {
  apiDocsController,
  catalogController,
  healthController,
  rootController,
  systemStatusController
} from '../controller/systemController.js';

export const registerSystemRoutes = (app) => {
  registerRoute({
    app,
    method: 'GET',
    path: '/api/routes',
    category: 'Infraestrutura',
    description: 'Retorna o catálogo dinâmico de rotas registradas pela aplicação.',
    auth: 'Não aplicável',
    kind: 'infraestrutura',
    hidden: true,
    handler: catalogController
  });

  registerRoute({
    app,
    method: 'GET',
    path: '/api',
    category: 'Infraestrutura',
    description: 'Página de documentação interativa da API.',
    auth: 'Não aplicável',
    kind: 'infraestrutura',
    hidden: false,
    handler: apiDocsController
  });

  registerRoute({
    app,
    method: 'GET',
    path: '/',
    category: 'Infraestrutura',
    description: 'Redireciona para a documentação principal da API.',
    auth: 'Não aplicável',
    kind: 'infraestrutura',
    hidden: false,
    handler: rootController
  });

  registerRoute({
    app,
    method: 'GET',
    path: '/health',
    category: 'Infraestrutura',
    description: 'Verifica se a API está respondendo corretamente.',
    auth: 'Não aplicável',
    kind: 'infraestrutura',
    hidden: false,
    handler: healthController
  });

  registerRoute({
    app,
    method: 'GET',
    path: '/api/system/status',
    category: 'Infraestrutura',
    description: 'Retorna o status real da API e o ambiente de execução.',
    auth: 'Não aplicável',
    kind: 'infraestrutura',
    hidden: false,
    handler: systemStatusController
  });

  registerRoute({
    method: 'GET',
    path: '/api-docs',
    category: 'Infraestrutura',
    description: 'Documentação interativa Swagger UI da API.',
    auth: 'Não aplicável',
    kind: 'infraestrutura',
    hidden: false
  });
};
