-- Seed 0001: catálogo de personagens
--
-- Pode ser executado várias vezes: se o personagem já existir, os dados são atualizados (upsert).
-- Este arquivo é a fonte oficial do catálogo; altere aqui e rode "npm run db:seed".
--
-- Os três personagens jogáveis. starts_unlocked diz quem já começa liberado:
-- - Tung Tung Sahur: sempre liberado;
-- - Tung Tung Sabor: liberado quando o jogador pega o Elixir Elétrico (POST /api/unlocks);
-- - Tung Tung God: liberado quando o jogador vence o jogo com o Sahur (POST /api/unlocks).
-- sprite_path é a foto do personagem na seleção, servida pelo TBOTT_web (public/sprites/characters).
-- Os atributos (dano, velocidade, vida...) ficam só no TBOTT_web (src/data/characterStats.js).

insert into public.characters (id, name, description, sprite_path, display_order, starts_unlocked)
values
  (
    'tung-tung-sahur', 'Tung Tung Sahur',
    'Ataca inimigos próximos usando um bastão.',
    '/sprites/characters/tung-tung-sahur/selecao.jpg', 1, true
  ),
  (
    'tung-tung-sabor', 'Tung Tung Sabor',
    'Garrafa de whisky com cafeína. O bastão respinga e deixa os inimigos próximos lentos.',
    '/sprites/characters/tung-tung-sabor/selecao.jpg', 2, false
  ),
  (
    'tung-tung-god', 'Tung Tung God',
    'Voa por cima de obstáculos. O cetro solta uma explosão de luz nos inimigos próximos.',
    '/sprites/characters/tung-tung-god/selecao.jpg', 3, false
  )
on conflict (id) do update
set
  name = excluded.name,
  description = excluded.description,
  sprite_path = excluded.sprite_path,
  display_order = excluded.display_order,
  starts_unlocked = excluded.starts_unlocked;
