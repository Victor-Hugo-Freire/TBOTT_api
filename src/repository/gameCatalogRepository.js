import { getDatabasePool } from '../config/database.js';
import { AppError } from '../utils/httpError.js';

// Roda uma consulta do catálogo. Se o banco falhar, a rota responde 503 com um código fixo
// e o detalhe do erro fica só no log.
const queryCatalog = async (db, table, sql) => {
  try {
    const result = await db.query(sql);
    return result.rows;
  } catch (error) {
    console.error(`[catalog] table=${table} errorCode=${error?.code ?? 'CATALOG_QUERY_ERROR'}`);

    throw new AppError({
      statusCode: 503,
      code: 'CATALOG_QUERY_FAILED',
      message: 'Não foi possível consultar o catálogo do jogo no momento.'
    });
  }
};

export const findAllItems = async (db = getDatabasePool()) => queryCatalog(db, 'items', `
  select id, name, description, type, rarity, effect, room_types, price, sprite_path, icon_path
  from public.items
  order by name
`);

export const findAllEnemies = async (db = getDatabasePool()) => queryCatalog(db, 'enemies', `
  select id, name, description, health, damage, speed, behavior, min_floor, sprite_legs_path, sprite_body_path
  from public.enemies
  order by min_floor, name
`);

export const findAllBosses = async (db = getDatabasePool()) => queryCatalog(db, 'bosses', `
  select id, name, description, health, damage, attacks, min_floor, max_floor, sprite_legs_path, sprite_body_path
  from public.bosses
  order by min_floor, max_floor, name
`);
