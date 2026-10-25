-- Seed 0001: catálogo de personagens
--
-- Pode ser executado várias vezes: se o personagem já existir, os dados são atualizados (upsert).
-- Este arquivo é a fonte oficial do catálogo; altere aqui e rode "npm run db:seed".
--
-- Confirmado até agora (protótipo e issue TBOTT_web #8): apenas o Tung Tung Sahur.
-- Os outros dois personagens ainda não têm nome, atributos nem sprite e serão adicionados depois.
-- sprite_path fica nulo até o arquivo do sprite existir e ser servido pelo TBOTT_web.

insert into public.characters (id, name, description, sprite_path, display_order)
values
  ('tung-tung-sahur', 'Tung Tung Sahur', 'Ataca inimigos próximos usando um bastão.', null, 1)
on conflict (id) do update
set
  name = excluded.name,
  description = excluded.description,
  sprite_path = excluded.sprite_path,
  display_order = excluded.display_order;
