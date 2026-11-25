-- Seed 0004: catálogo de chefes
--
-- Pode ser executado várias vezes: se o chefe já existir, os dados são atualizados (upsert).
-- Este arquivo é a fonte oficial dos chefes. Para rebalancear, mude o número aqui e rode
-- "npm run db:seed".
--
-- Unidades:
--   health  = vida em pontos. Valor de referência deste catálogo: o golpe básico do bastão
--             tira 3 (vida 60 = 20 golpes). O TBOTT_web ainda não tem dano de golpe: quando o
--             combate existir, deve usar esse valor (ou a vida daqui muda junto).
--   damage  = dano de encostar no chefe, em meios corações (1 = meio coração, 2 = um coração).
--   attacks = lista de ataques. O "id" é o nome da animação no TBOTT_web
--             (src/data/bossSprites.js) e o "damage" também é em meios corações.
--             Dano 0 = o ataque atrapalha, mas não machuca (ex.: a casca escorregadia).
--   min_floor e max_floor = andares em que o chefe pode ser sorteado.
--             Andares 1 a 4 têm chefe sorteado; o do andar 5 é sempre o Tralalero Tralala.
-- Os números são a primeira proposta de balanceamento: nenhum chefe existe no jogo ainda.
-- A Nonna tem 4 camadas de lasanha no sprite: 72 de vida = 4 camadas de 18.

insert into public.bosses (id, name, description, health, damage, attacks, min_floor, max_floor, sprite_legs_path, sprite_body_path)
values
  (
    'cinquecento-turbo', 'Cinquecento Turbo',
    'Investe e ricocheteia nas paredes, buzina e abre o capô para esfriar.',
    60, 1,
    '[{"id": "investida", "name": "Investida", "damage": 1}, {"id": "atacando", "name": "Buzina", "damage": 1}]',
    1, 2,
    '/sprites/bosses/cinquecento-turbo/cinquecento-turbo-pernas.png',
    '/sprites/bosses/cinquecento-turbo/cinquecento-turbo-tronco.png'
  ),
  (
    'chimpanzini-bananini', 'Chimpanzini Bananini',
    'Lança uma banana-bumerangue e deixa casca escorregadia; na segunda fase perde a casca.',
    60, 1,
    '[{"id": "atacando", "name": "Banana-bumerangue", "damage": 1}, {"id": "descascar", "name": "Casca escorregadia", "damage": 0}]',
    1, 2,
    '/sprites/bosses/chimpanzini-bananini/chimpanzini-bananini-pernas.png',
    '/sprites/bosses/chimpanzini-bananini/chimpanzini-bananini-tronco.png'
  ),
  (
    'brr-brr-patapim', 'Brr Brr Patapim',
    'Pisão com onda de choque e raízes em linha.',
    66, 1,
    '[{"id": "atacando", "name": "Pisão", "damage": 1}, {"id": "raizes", "name": "Raízes", "damage": 1}]',
    1, 2,
    '/sprites/bosses/brr-brr-patapim/brr-brr-patapim-pernas.png',
    '/sprites/bosses/brr-brr-patapim/brr-brr-patapim-tronco.png'
  ),
  (
    'nonna-lasagnona', 'Nonna Lasagnona',
    'Colherada com onda de choque, invoca almôndegas e perde camadas de lasanha.',
    72, 1,
    '[{"id": "atacando", "name": "Colherada", "damage": 1}, {"id": "invocar", "name": "Almôndegas", "damage": 1}]',
    1, 4,
    '/sprites/bosses/nonna-lasagnona/nonna-lasagnona-pernas.png',
    '/sprites/bosses/nonna-lasagnona/nonna-lasagnona-tronco.png'
  ),
  (
    'ballerina-cappuccina', 'Ballerina Cappuccina',
    'Pirueta que ricocheteia e gotas de café; fica tonta ao acertar a parede.',
    84, 1,
    '[{"id": "pirueta", "name": "Pirueta", "damage": 1}, {"id": "atacando", "name": "Gota de café", "damage": 1}]',
    3, 4,
    '/sprites/bosses/ballerina-cappuccina/ballerina-cappuccina-pernas.png',
    '/sprites/bosses/ballerina-cappuccina/ballerina-cappuccina-tronco.png'
  ),
  (
    'cappuccino-assassino', 'Cappuccino Assassino',
    'Teleporta, corta com a katana e se divide em clones.',
    84, 1,
    '[{"id": "atacando", "name": "Corte de katana", "damage": 2}, {"id": "clones", "name": "Clones", "damage": 1}]',
    3, 4,
    '/sprites/bosses/cappuccino-assassino/cappuccino-assassino-pernas.png',
    '/sprites/bosses/cappuccino-assassino/cappuccino-assassino-tronco.png'
  ),
  (
    'bombardiro-crocodilo', 'Bombardiro Crocodilo',
    'Marca o chão e bombardeia; pousa para abastecer.',
    90, 1,
    '[{"id": "atacando", "name": "Bombardeio", "damage": 2}]',
    3, 4,
    '/sprites/bosses/bombardiro-crocodilo/bombardiro-crocodilo-pernas.png',
    '/sprites/bosses/bombardiro-crocodilo/bombardiro-crocodilo-tronco.png'
  ),
  (
    'tralalero-tralala', 'Tralalero Tralala',
    'Chefe final, em três fases: investida tripla, mordida, canto com pauta musical e mergulho.',
    135, 2,
    '[{"id": "investida", "name": "Investida", "damage": 2}, {"id": "atacando", "name": "Mordida", "damage": 2}, {"id": "canto-tralala", "name": "Canto", "damage": 1}, {"id": "pauta", "name": "Pauta musical", "damage": 1}, {"id": "salto-mergulho", "name": "Mergulho", "damage": 2}]',
    5, 5,
    '/sprites/bosses/tralalero-tralala/tralalero-tralala-pernas.png',
    '/sprites/bosses/tralalero-tralala/tralalero-tralala-tronco.png'
  )
on conflict (id) do update
set
  name = excluded.name,
  description = excluded.description,
  health = excluded.health,
  damage = excluded.damage,
  attacks = excluded.attacks,
  min_floor = excluded.min_floor,
  max_floor = excluded.max_floor,
  sprite_legs_path = excluded.sprite_legs_path,
  sprite_body_path = excluded.sprite_body_path;
