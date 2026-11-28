import { z } from 'zod';

import { findUnlocksByUserId, insertUnlock } from '../repository/unlockRepository.js';

// O jogador NÃO vem do corpo: é o da sessão. Campos extras (como userId) são descartados pelo zod.
export const createUnlockSchema = z.object({
  characterId: z.string().trim().min(1, 'Personagem é obrigatório.')
});

const toUnlock = (row) => ({
  characterId: row.character_id,
  unlockedAt: row.unlocked_at
});

export const listUnlocks = async (userId, db) => {
  const rows = await findUnlocksByUserId(userId, db);

  return rows.map(toUnlock);
};

export const createUnlock = async (userId, data, db) => {
  const { row, created } = await insertUnlock({ userId, characterId: data.characterId }, db);

  return { unlock: toUnlock(row), created };
};
