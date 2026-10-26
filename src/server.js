import app from './app.js';
import { closeDatabasePool, testDatabaseConnection } from './config/database.js';
import config from './config/index.js';

const server = app.listen(config.port, async () => {
    console.log(`Documentação interativa: http://localhost:${config.port}/api`);
    console.log(`Swagger UI: http://localhost:${config.port}/api-docs`);

    if (config.frontendOrigins.length === 0) {
        console.warn('[cors] FRONTEND_ORIGINS não configurada: nenhum front-end conseguirá usar a API pelo navegador.');
    }

    const databaseStatus = await testDatabaseConnection();
    if (databaseStatus.connected) {
        console.log('[database] PostgreSQL conectado com sucesso.');
        return;
    }

    console.warn('[database] PostgreSQL indisponível:', databaseStatus.message);
});

const shutdown = async (signal) => {
    console.log(`[server] Encerrando aplicação (${signal})...`);
    await closeDatabasePool();
    server.close(() => process.exit(0));
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export default server;