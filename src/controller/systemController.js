import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDocumentedRoutes } from '../docs/catalog.js';
import { buildHealthPayload, buildSystemStatusPayload } from '../service/systemService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.join(__dirname, '..', 'docs');

export const catalogController = (_req, res) => {
  res.json({ routes: getDocumentedRoutes() });
};

export const apiDocsController = (_req, res) => {
  res.sendFile(path.join(docsDir, 'index.html'));
};

export const rootController = (_req, res) => {
  res.redirect('/api');
};

export const healthController = (_req, res) => {
  res.json(buildHealthPayload());
};

export const systemStatusController = async (_req, res) => {
  res.json(await buildSystemStatusPayload());
};
