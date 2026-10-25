import 'dotenv/config';

const config = {
    port: Number(process.env.PORT) || 8000,
    nodeEnv: process.env.NODE_ENV || 'development',
    databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:your-password@localhost:5432/postgres',
    databaseSslCaPath: process.env.DATABASE_SSL_CA_PATH || ''
};

export default config;
