import { readFileSync } from 'node:fs';

import { testDatabaseConnection } from '../config/database.js';
import config from '../config/index.js';

export const getRuntimeMetadata = () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

  return {
    name: pkg.name,
    version: pkg.version,
    nodeEnv: config.nodeEnv,
    port: config.port
  };
};

export const getDatabaseHealthStatus = async () => {
  const health = await testDatabaseConnection();

  return {
    connected: health.connected,
    provider: health.provider,
    message: health.message
  };
};
