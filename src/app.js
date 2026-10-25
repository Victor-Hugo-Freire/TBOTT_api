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
import { AppError } from './utils/httpError.js';

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.join(__dirname, 'docs');

app.use(express.json());
app.use('/docs', express.static(docsDir));
registerSystemRoutes(app);
registerAuthRoutes(app);
registerCharacterRoutes(app);
registerRankingRoutes(app);

const GENERIC_ERROR_MESSAGE = 'Não foi possível concluir a operação no momento.';

// Erros no formato { error, code, details? }. "error" é a mensagem, como nas outras rotas;
// "code" é um código fixo para o front-end decidir o que mostrar.
app.use((error, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  // JSON malformado: a mensagem do parser repete trechos do corpo, que pode conter a senha.
  if (error?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'O corpo da requisição não é um JSON válido.', code: 'INVALID_JSON' });
    return;
  }

  if (error instanceof AppError) {
    const isServerError = error.statusCode >= 500;

    if (isServerError) {
      console.error(`[api] ${error.code}: ${error.message}`);
    }

    res.status(error.statusCode).json({
      error: isServerError ? GENERIC_ERROR_MESSAGE : error.message,
      code: error.code,
      ...(error.details ? { details: error.details } : {})
    });
    return;
  }

  // Outros erros (ex.: corpo grande demais) nunca repassam a mensagem original ao cliente.
  const isClientError = Number.isInteger(error?.status) && error.status >= 400 && error.status < 500;

  if (!isClientError) {
    console.error('[api] Erro inesperado:', error?.stack ?? error);
  }

  res.status(isClientError ? error.status : 500).json({
    error: isClientError ? 'Requisição inválida.' : GENERIC_ERROR_MESSAGE,
    code: isClientError ? 'INVALID_REQUEST' : 'INTERNAL_ERROR'
  });
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