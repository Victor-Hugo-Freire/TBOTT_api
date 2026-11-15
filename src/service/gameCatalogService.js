import { findAllBosses, findAllEnemies, findAllItems } from '../repository/gameCatalogRepository.js';

// As colunas do banco usam sublinhado (sprite_path); a resposta da API usa camelCase (spritePath),
// como nas outras rotas.

const toItem = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  type: row.type,
  rarity: row.rarity,
  effect: row.effect,
  roomTypes: row.room_types,
  price: row.price,
  spritePath: row.sprite_path,
  iconPath: row.icon_path
});

const toEnemy = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  health: row.health,
  damage: row.damage,
  speed: row.speed,
  behavior: row.behavior,
  minFloor: row.min_floor,
  spriteLegsPath: row.sprite_legs_path,
  spriteBodyPath: row.sprite_body_path
});

const toBoss = (row) => ({
  id: row.id,
  name: row.name,
  description: row.description,
  health: row.health,
  damage: row.damage,
  attacks: row.attacks,
  minFloor: row.min_floor,
  maxFloor: row.max_floor,
  spriteLegsPath: row.sprite_legs_path,
  spriteBodyPath: row.sprite_body_path
});

// Catálogo inteiro de uma vez: o jogo busca no começo da partida e guarda na memória.
export const getGameCatalog = async (db) => {
  const items = await findAllItems(db);
  const enemies = await findAllEnemies(db);
  const bosses = await findAllBosses(db);

  return {
    items: items.map(toItem),
    enemies: enemies.map(toEnemy),
    bosses: bosses.map(toBoss)
  };
};
