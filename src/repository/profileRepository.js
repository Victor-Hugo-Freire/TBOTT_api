import { getDatabasePool } from '../config/database.js';
import { AppError } from '../utils/httpError.js';

const reportProfileQueryError = (stage, error) => {
  const code = error?.code ?? 'PROFILE_QUERY_ERROR';
  console.error(`[auth] stage=${stage} errorCode=${code}`);
};

export const findProfileByUsername = async (username, db = getDatabasePool()) => {
  console.info('[auth:register] stage=username_lookup');

  if (!db) {
    throw new AppError({
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Banco de dados indisponível no momento.'
    });
  }

  try {
    const result = await db.query(
      'select id, username from public.profiles where lower(username) = lower($1) limit 1',
      [username]
    );

    return result.rows[0] ?? null;
  } catch (error) {
    reportProfileQueryError('username_lookup', error);
    throw new AppError({
      statusCode: 503,
      code: 'PROFILE_QUERY_FAILED',
      message: 'Não foi possível verificar o nome de usuário no momento.'
    });
  }
};

// Usado no cadastro, no login e no GET /api/auth/me.
export const findProfileById = async (userId, db = getDatabasePool()) => {
  console.info('[auth] stage=profile_lookup');

  if (!db) {
    throw new AppError({
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Banco de dados indisponível no momento.'
    });
  }

  try {
    const result = await db.query(
      'select id, username from public.profiles where id = $1 limit 1',
      [userId]
    );

    return result.rows[0] ?? null;
  } catch (error) {
    reportProfileQueryError('profile_lookup', error);
    throw new AppError({
      statusCode: 503,
      code: 'PROFILE_QUERY_FAILED',
      message: 'Não foi possível carregar o perfil do usuário no momento.'
    });
  }
};
