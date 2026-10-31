import { getDatabasePool } from '../config/database.js';
import { AppError } from '../utils/httpError.js';

// Grava uma run já encerrada. O jogo envia só o tempo total; o início é calculado para a run
// respeitar a regra do banco (finished_at >= started_at).
export const insertRun = async ({ userId, characterId, status, durationMs }, db = getDatabasePool()) => {
  if (!db) {
    throw new AppError({
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Banco de dados indisponível no momento.'
    });
  }

  try {
    const result = await db.query(
      `insert into public.game_runs (user_id, character_id, status, duration_ms, started_at, finished_at)
       values ($1, $2, $3, $4::int, now() - ($4::int * interval '1 millisecond'), now())
       returning id, character_id, status, duration_ms, finished_at`,
      [userId, characterId, status, durationMs]
    );

    return result.rows[0];
  } catch (error) {
    // 23503 = chave estrangeira: o personagem não existe no catálogo.
    if (error?.code === '23503') {
      throw new AppError({
        statusCode: 422,
        code: 'CHARACTER_NOT_FOUND',
        message: 'Personagem não encontrado.'
      });
    }

    console.error(`[runs] errorCode=${error?.code ?? 'RUN_SAVE_ERROR'}`);
    throw new AppError({
      statusCode: 503,
      code: 'RUN_SAVE_FAILED',
      message: 'Não foi possível registrar a partida no momento.'
    });
  }
};
