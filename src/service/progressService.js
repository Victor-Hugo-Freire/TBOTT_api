import { z } from 'zod';

import {
  findProgressByUserId,
  hasProgressByUserId,
  upsertProgress
} from '../repository/progressRepository.js';

export const createProgressSchema = z.any().refine(
  (value) => value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value),
  { message: 'Progresso deve ser um objeto JSON válido.' }
);

export const normalizeProgressPayload = (value) => {
  const parsed = createProgressSchema.parse(value);
  const { userId, ...payload } = parsed;
  return payload;
};

export const saveProgress = async (userId, data, { repo, db } = {}) => {
  const save = repo?.upsertProgress ?? upsertProgress;
  const payload = normalizeProgressPayload(data);
  const row = await save({ userId, payload }, db);

  return {
    exists: true,
    progress: row.payload
  };
};

export const getProgress = async (userId, db) => {
  const row = await findProgressByUserId(userId, db);

  if (!row) {
    return { exists: false, progress: null };
  }

  return {
    exists: true,
    progress: row.payload
  };
};

export const hasProgress = async (userId, db) => hasProgressByUserId(userId, db);
