import pg from 'pg';

import config from './index.js';

const { Pool } = pg;

let databasePool = null;

export const buildPoolConfig = (databaseUrl = config.databaseUrl || process.env.DATABASE_URL) => {
    if (!databaseUrl) {
        return {
            connectionString: undefined,
            ssl: false
        };
    }

    const requiresRemoteSsl = !databaseUrl.includes('localhost') && !databaseUrl.includes('127.0.0.1');

    return {
        connectionString: databaseUrl,
        ...(requiresRemoteSsl ? { ssl: { rejectUnauthorized: false } } : {})
    };
};

export const getDatabasePool = () => {
    if (!databasePool) {
        const poolConfig = buildPoolConfig();

        if (!poolConfig.connectionString) {
            return null;
        }

        databasePool = new Pool(poolConfig);
        databasePool.on('error', (error) => {
            console.error('[database] Erro inesperado no pool do PostgreSQL:', error.message);
        });
    }

    return databasePool;
};

export const closeDatabasePool = async () => {
    if (databasePool) {
        await databasePool.end();
        databasePool = null;
    }
};

export const testDatabaseConnection = async (targetPool = getDatabasePool()) => {
    if (!targetPool) {
        return {
            connected: false,
            provider: 'postgresql',
            message: 'DATABASE_URL não configurada.'
        };
    }

    try {
        const result = await targetPool.query('SELECT 1 AS ok');

        return {
            connected: true,
            provider: 'postgresql',
            message: 'PostgreSQL conectado com sucesso.',
            rowCount: result.rowCount ?? 0
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Erro desconhecido ao conectar com PostgreSQL.';

        console.error('[database] Falha ao conectar com PostgreSQL:', message);

        return {
            connected: false,
            provider: 'postgresql',
            message: 'PostgreSQL indisponível no momento.',
            error: message
        };
    }
};

export default getDatabasePool();
