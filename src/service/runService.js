import { z } from 'zod';

import { insertRun } from '../repository/runRepository.js';

// Limite de 24 h: cabe no integer do banco e barra tempos absurdos.
export const RUN_MAX_DURATION_MS = 24 * 60 * 60 * 1000;

// Só entra o resultado de uma partida encerrada. O jogador NÃO vem do corpo: é o da sessão.
// Campos extras (como userId) são descartados pelo zod.
export const createRunSchema = z.object({
  characterId: z.string().trim().min(1, 'Personagem é obrigatório.'),
  durationMs: z.number().int('Tempo deve ser um número inteiro (milissegundos).')
    .min(1, 'Tempo deve ser maior que zero.')
    .max(RUN_MAX_DURATION_MS, 'Tempo acima do máximo permitido (24 horas).'),
  status: z.enum(['victory', 'defeat'], { error: 'Status deve ser "victory" ou "defeat".' })
});

// Nos testes, repo troca o banco por um em memória.
export const createRun = async (userId, data, { repo } = {}) => {
  const save = repo?.insertRun ?? insertRun;
  const row = await save({ userId, ...data });

  return {
    id: row.id,
    characterId: row.character_id,
    status: row.status,
    durationMs: row.duration_ms,
    finishedAt: row.finished_at
  };
};
