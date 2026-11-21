-- Seed 0002: catálogo de itens
--
-- Pode ser executado várias vezes: se o item já existir, os dados são atualizados (upsert).
-- Este arquivo é a fonte oficial dos itens. Para cadastrar um item novo, acrescente uma linha
-- aqui e rode "npm run db:seed" (os sprites e as animações ficam no TBOTT_web).
--
-- Colunas:
--   room_types  = ids de ROOM_TYPES do TBOTT_web (src/utils/floorGenerator.js)
--   price       = grãos de café na Loja; null = não é vendido
--   sprite_path = folha de animação; icon_path = ícone parado
--
-- Números do "effect" (os nomes das chaves são deste seed e podem ser trocados aqui):
--   - dano usa a mesma escala da vida dos inimigos: o golpe básico do bastão vale 3
--     (valor de referência deste catálogo; o TBOTT_web ainda não tem dano de golpe);
--   - vida do jogador é em meios corações (1 coração = 2);
--   - distâncias em unidades da sala; tempos em milissegundos;
--   - multiplicadores e chances são frações (1.4 = 40% a mais; 0.1 = 10%).
-- Os efeitos estão no TBOTT_web (src/utils/itemEffects.js), que lê estes números. Ajustes de 2026-11-21
-- (decisões do Victor): Parmesão solta as lascas em todo golpe e elas voam até um inimigo, um obstáculo ou a
-- parede (sem alcance); a poça da Concha nasce nos pés do inimigo atingido; o Tiramisu acelera golpe e passo a
-- cada acerto e custa 15 grãos; o frenesi do Dente tem teto (maxAttackSpeedBonus).
-- Efeitos secundários do efeitos.md, sempre ativos enquanto o jogador tem o item (2026-11-21):
--   Muçarela maxHealthBonus (+1 coração, que já vem cheio), Batuta invincibilityBonusMs, Elixir speedMultiplier e
--   attackSpeedBonus (golpe de 630 para 567 ms) e Concha attackAreaMultiplier (caixa do golpe maior).

insert into public.items (id, name, description, type, rarity, effect, room_types, price, sprite_path, icon_path)
values
  (
    'cafe-duplo', 'Café Duplo',
    'Depois de levar dano, o Tung Tung corre mais rápido por alguns segundos.',
    'passivo', 'comum',
    '{"trigger": "levar-dano", "speedMultiplier": 1.05, "boostSpeedMultiplier": 1.4, "boostDurationMs": 3000}',
    '["tesouro"]', null,
    '/sprites/items/cafe-duplo/cafe-duplo.png', '/sprites/items/cafe-duplo/cafe-duplo-icone.png'
  ),
  (
    'parmesao-curado', 'Parmesão Curado',
    'Todo golpe solta três lascas de queijo, que voam até acertar um inimigo, um obstáculo ou a parede.',
    'passivo', 'comum',
    '{"trigger": "golpe", "shards": 3, "shardDamage": 1}',
    '["tesouro"]', null,
    '/sprites/items/parmesao-curado/parmesao-curado.png', '/sprites/items/parmesao-curado/parmesao-curado-icone.png'
  ),
  (
    'concha-longa', 'Concha Longa',
    'O golpe fica maior. O golpe que acerta deixa uma poça de molho nos pés do inimigo, que fica lento dentro dela.',
    'passivo', 'comum',
    '{"trigger": "golpe-acerta", "puddleDurationMs": 2000, "enemySpeedMultiplier": 0.5, "attackAreaMultiplier": 1.15}',
    '["tesouro"]', null,
    '/sprites/items/concha-longa/concha-longa.png', '/sprites/items/concha-longa/concha-longa-icone.png'
  ),
  (
    'palitos-de-pao', 'Palitos de Pão',
    'O quarto golpe sai mais rápido e empurra os inimigos próximos.',
    'passivo', 'comum',
    '{"trigger": "quarto-golpe", "attackSpeedBonus": 0.4, "pushRange": 60}',
    '["tesouro"]', null,
    '/sprites/items/palitos-de-pao/palitos-de-pao.png', '/sprites/items/palitos-de-pao/palitos-de-pao-icone.png'
  ),
  (
    'mucarela', 'Muçarela',
    'Dá mais um coração de vida. O golpe que acerta prende o inimigo em fios de queijo.',
    'passivo', 'incomum',
    '{"trigger": "golpe-acerta", "stunDurationMs": 800, "maxHealthBonus": 2}',
    '["tesouro"]', null,
    '/sprites/items/mucarela/mucarela.png', '/sprites/items/mucarela/mucarela-icone.png'
  ),
  (
    'tiramisu', 'Tiramisu',
    'Cada golpe que acerta deixa o golpe e o passo mais rápidos por alguns segundos.',
    'passivo', 'incomum',
    '{"trigger": "golpe-acerta", "attackSpeedBonus": 0.25, "moveSpeedMultiplier": 1.2, "bonusDurationMs": 2000}',
    '["loja"]', 15,
    '/sprites/items/tiramisu/tiramisu.png', '/sprites/items/tiramisu/tiramisu-icone.png'
  ),
  (
    'rolo-de-bronze', 'Rolo de Bronze',
    'O golpe empurra o inimigo com força; se ele bater na parede, leva mais dano.',
    'passivo', 'incomum',
    '{"trigger": "golpe-acerta", "pushDistance": 120, "wallExtraDamage": 2}',
    '["chefe"]', null,
    '/sprites/items/rolo-de-bronze/rolo-de-bronze.png', '/sprites/items/rolo-de-bronze/rolo-de-bronze-icone.png'
  ),
  (
    'chifre-da-sorte', 'Chifre da Sorte',
    'Inimigos abatidos têm chance de soltar um grão de café.',
    'passivo', 'incomum',
    '{"trigger": "abate", "extraCoinChance": 0.1}',
    '["fliperama"]', null,
    '/sprites/items/chifre-da-sorte/chifre-da-sorte.png', '/sprites/items/chifre-da-sorte/chifre-da-sorte-icone.png'
  ),
  (
    'batuta-do-maestro', 'Batuta do Maestro',
    'Golpes no ritmo causam mais dano, e o quarto seguido solta uma onda sonora. Depois de levar dano, fica invencível por mais tempo.',
    'passivo', 'incomum',
    '{"trigger": "golpe-no-ritmo", "rhythmWindowMs": 150, "extraDamage": 1, "comboHits": 4, "waveRange": 80, "invincibilityBonusMs": 200}',
    '["palco"]', null,
    '/sprites/items/batuta-do-maestro/batuta-do-maestro.png', '/sprites/items/batuta-do-maestro/batuta-do-maestro-icone.png'
  ),
  (
    'dente-de-tubarao', 'Dente de Tubarão',
    'Cada abate deixa o golpe mais rápido, e inimigos com metade da vida levam dano dobrado. Custa um coração de vida máxima.',
    'passivo', 'especial',
    '{"trigger": "abate", "attackSpeedBonus": 0.15, "maxAttackSpeedBonus": 0.3, "bonusDurationMs": 4000, "maxStacks": 3, "lowHealthDamageMultiplier": 2, "maxHealthCost": 2}',
    '["pacto"]', null,
    '/sprites/items/dente-de-tubarao/dente-de-tubarao.png', '/sprites/items/dente-de-tubarao/dente-de-tubarao-icone.png'
  ),
  (
    'caldo-da-mamae', 'Caldo da Mamãe',
    'Anula o primeiro dano de cada sala e cura quando a vida chega a um coração.',
    'passivo', 'especial',
    '{"trigger": "entrar-em-sala", "blockedHitsPerRoom": 1, "healAtHealth": 2, "healAmount": 4, "healsPerFloor": 1}',
    '["god"]', null,
    '/sprites/items/caldo-da-mamae/caldo-da-mamae.png', '/sprites/items/caldo-da-mamae/caldo-da-mamae-icone.png'
  ),
  (
    'elixir-eletrico', 'Elixir Elétrico',
    'Anda e golpeia mais rápido. O terceiro golpe seguido que acerta solta um raio que salta para os inimigos próximos.',
    'passivo', 'raro',
    '{"trigger": "terceiro-golpe-seguido", "extraDamage": 2, "chainTargets": 2, "chainRange": 120, "chainDamage": 1, "speedMultiplier": 1.1, "attackSpeedBonus": 0.11}',
    '["adega"]', null,
    '/sprites/items/elixir-eletrico/elixir-eletrico.png', '/sprites/items/elixir-eletrico/elixir-eletrico-icone.png'
  )
on conflict (id) do update
set
  name = excluded.name,
  description = excluded.description,
  type = excluded.type,
  rarity = excluded.rarity,
  effect = excluded.effect,
  room_types = excluded.room_types,
  price = excluded.price,
  sprite_path = excluded.sprite_path,
  icon_path = excluded.icon_path;
