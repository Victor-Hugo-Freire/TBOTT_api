import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import config from './config/index.js';
import { createSwaggerSpec } from './docs/catalog.js';
import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerCharacterRoutes } from './routes/character.routes.js';
import { registerRankingRoutes } from './routes/ranking.routes.js';
import { registerSystemRoutes } from './routes/system.routes.js';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.join(__dirname, 'docs');

app.use(express.json());
app.use('/docs', express.static(docsDir));
registerSystemRoutes(app);
registerAuthRoutes(app);
registerCharacterRoutes(app);
registerRankingRoutes(app);

app.use((error, _req, res, _next) => {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  const code = error?.code ?? 'INTERNAL_ERROR';
  const message = statusCode >= 500
    ? 'Não foi possível concluir a operação no momento.'
    : (error?.message ?? 'Requisição inválida.');

  if (statusCode >= 500) {
    console.error('[api] Erro interno:', error instanceof Error ? error.message : error);
  }

  const payload = {
    code,
    message,
    ...(error?.details ? { details: error.details } : {})
  };

  res.status(statusCode).json(payload);
});

const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'TBOTT API',
      version: '1.0.0',
      description: 'Documentação automática gerada a partir das rotas registradas na aplicação.'
    },
    servers: [{ url: `http://localhost:${config.port}` }]
  },
  apis: []
});

swaggerSpec.paths = createSwaggerSpec(config).paths;

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  customSiteTitle: 'TBOTT API - Swagger',
  customCss: '.topbar { display: none; }'
}));

export default app;