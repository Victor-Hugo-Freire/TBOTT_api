import {
  getDatabaseHealthStatus,
  getRuntimeMetadata
} from '../repository/systemRepository.js';

export const buildHealthPayload = () => ({
  status: 'ok',
  service: 'tbott_api',
  timestamp: new Date().toISOString()
});

export const buildSystemStatusPayload = async () => {
  const metadata = getRuntimeMetadata();
  const database = await getDatabaseHealthStatus();

  return {
    status: 'ok',
    service: metadata.name,
    version: metadata.version,
    environment: metadata.nodeEnv,
    port: metadata.port,
    uptimeSeconds: Number(process.uptime().toFixed(2)),
    database: {
      connected: database.connected,
      provider: database.provider,
      message: database.message
    },
    timestamp: new Date().toISOString()
  };
};
