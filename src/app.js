import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import config from './config/index.js';
import { createSwaggerSpec } from './docs/catalog.js';
import { registerCharacterRoutes } from './routes/character.routes.js';
import { registerRankingRoutes } from './routes/ranking.routes.js';
import { registerSystemRoutes } from './routes/system.routes.js';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.join(__dirname, 'docs');

app.use(express.json());
app.use('/docs', express.static(docsDir));
registerSystemRoutes(app);
registerCharacterRoutes(app);
registerRankingRoutes(app);

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