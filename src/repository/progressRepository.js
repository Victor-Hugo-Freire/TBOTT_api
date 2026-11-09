import { getDatabasePool } from '../config/database.js';
import { AppError } from '../utils/httpError.js';

const reportProgressQueryError = (stage, error) => {
  const code = error?.code ?? 'PROGRESS_QUERY_ERROR';
  console.error(`[progress] stage=${stage} errorCode=${code}`);
};

export const findProgressByUserId = async (userId, db = getDatabasePool()) => {
  if (!db) {
    throw new AppError({
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Banco de dados indisponível no momento.'
    });
  }

  try {
    const result = await db.query(
      'select user_id, payload, updated_at from public.player_progress where user_id = $1 limit 1',
      [userId]
    );

    return result.rows[0] ?? null;
  } catch (error) {
    reportProgressQueryError('find_progress', error);
    throw new AppError({
      statusCode: 503,
      code: 'PROGRESS_QUERY_FAILED',
      message: 'Não foi possível consultar o progresso do jogador no momento.'
    });
  }
};

export const hasProgressByUserId = async (userId, db = getDatabasePool()) => {
  const row = await findProgressByUserId(userId, db);
  return Boolean(row);
};

export const upsertProgress = async ({ userId, payload }, db = getDatabasePool()) => {
  if (!db) {
    throw new AppError({
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Banco de dados indisponível no momento.'
    });
  }

  try {
    const result = await db.query(
      `insert into public.player_progress (user_id, payload, updated_at)
       values ($1, $2::jsonb, now())
       on conflict (user_id) do update
       set payload = excluded.payload,
           updated_at = now()
       returning user_id, payload, updated_at`,
      [userId, JSON.stringify(payload)]
    );

    return result.rows[0];
  } catch (error) {
    reportProgressQueryError('upsert_progress', error);
    throw new AppError({
      statusCode: 503,
      code: 'PROGRESS_SAVE_FAILED',
      message: 'Não foi possível salvar o progresso no momento.'
    });
  }
};
