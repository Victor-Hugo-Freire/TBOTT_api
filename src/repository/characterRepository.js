import { getDatabasePool } from '../config/database.js';

export const findAllCharacters = async (db = getDatabasePool()) => {
  const result = await db.query(`
    select id, name, description, sprite_path, display_order
    from public.characters
    order by display_order, name
  `);

  return result.rows;
};
