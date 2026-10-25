import { z } from 'zod';

import { findRanking } from '../repository/rankingRepository.js';

export const RANKING_DEFAULT_LIMIT = 50;
export const RANKING_MAX_LIMIT = 100;

// Os valores chegam como texto na URL (?limit=10&offset=0), por isso o coerce.
export const rankingQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(RANKING_MAX_LIMIT).default(RANKING_DEFAULT_LIMIT),
  offset: z.coerce.number().int().min(0).default(0)
});

// Retorna apenas dados públicos: nada de e-mail, id do usuário ou outros dados privados.
export const toPublicRankingEntry = (row) => ({
  position: row.position,
  username: row.username,
  character: {
    id: row.character_id,
    name: row.character_name
  },
  durationMs: row.duration_ms,
  finishedAt: row.finished_at
});

export const listRanking = async ({ limit, offset }) => {
  const rows = await findRanking({ limit, offset });

  return rows.map(toPublicRankingEntry);
};
