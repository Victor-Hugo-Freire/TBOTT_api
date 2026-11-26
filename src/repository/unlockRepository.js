import { getDatabasePool } from '../config/database.js';
import { AppError } from '../utils/httpError.js';

const requireDatabase = (db) => {
  if (!db) {
    throw new AppError({
      statusCode: 503,
      code: 'DATABASE_UNAVAILABLE',
      message: 'Banco de dados indisponível no momento.'
    });
  }
};

// Os personagens que o jogador já liberou (sem o Sahur, que começa liberado: ele vem de GET /api/characters).
export const findUnlocksByUserId = async (userId, db = getDatabasePool()) => {
  requireDatabase(db);

  try {
    const result = await db.query(
      `select character_id, unlocked_at
       from public.character_unlocks
       where user_id = $1
       order by unlocked_at, character_id`,
      [userId]
    );

    return result.rows;
  } catch (error) {
    console.error(`[unlocks] stage=find_unlocks errorCode=${error?.code ?? 'UNLOCK_QUERY_ERROR'}`);
    throw new AppError({
      statusCode: 503,
      code: 'UNLOCK_QUERY_FAILED',
      message: 'Não foi possível consultar os personagens liberados no momento.'
    });
  }
};

// Libera o personagem para o jogador. Se ele já estava liberado, não duplica: devolve o registro que existia.
// Devolve { row, created }: created é false quando o personagem já estava liberado.
export const insertUnlock = async ({ userId, characterId }, db = getDatabasePool()) => {
  requireDatabase(db);

  try {
    const inserted = await db.query(
      `insert into public.character_unlocks (user_id, character_id)
       values ($1, $2)
       on conflict (user_id, character_id) do nothing
       returning character_id, unlocked_at`,
      [userId, characterId]
    );

    if (inserted.rows.length > 0) {
      return { row: inserted.rows[0], created: true };
    }

    const existing = await db.query(
      'select character_id, unlocked_at from public.character_unlocks where user_id = $1 and character_id = $2',
      [userId, characterId]
    );

    return { row: existing.rows[0], created: false };
  } catch (error) {
    // 23503 = chave estrangeira: o personagem não existe no catálogo.
    if (error?.code === '23503') {
      throw new AppError({
        statusCode: 422,
        code: 'CHARACTER_NOT_FOUND',
        message: 'Personagem não encontrado.'
      });
    }

    console.error(`[unlocks] stage=insert_unlock errorCode=${error?.code ?? 'UNLOCK_SAVE_ERROR'}`);
    throw new AppError({
      statusCode: 503,
      code: 'UNLOCK_SAVE_FAILED',
      message: 'Não foi possível liberar o personagem no momento.'
    });
  }
};
