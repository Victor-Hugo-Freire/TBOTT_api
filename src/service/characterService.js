import { findAllCharacters } from '../repository/characterRepository.js';

export const listCharacters = async () => {
  const rows = await findAllCharacters();

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    spritePath: row.sprite_path,
    displayOrder: row.display_order
  }));
};
