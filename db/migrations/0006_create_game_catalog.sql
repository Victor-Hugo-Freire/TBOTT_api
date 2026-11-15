-- Migração 0006: catálogo do jogo (itens, inimigos e chefes)
--
-- Os dados ficam em db/seeds (0002_items, 0003_enemies e 0004_bosses). Para rebalancear,
-- cadastrar um item novo ou trocar um sprite, altere o seed e rode "npm run db:seed":
-- não é preciso migração nova.
--
-- O "id" é o mesmo das pastas de sprites do TBOTT_web (ex.: 'cafe-duplo').
-- A imagem não fica no banco: as colunas de sprite guardam só o caminho, em texto
-- (ex.: '/sprites/items/cafe-duplo/cafe-duplo.png'). Trocar a imagem é trocar esse texto.
--
-- Unidades:
--   vida (health)      = pontos. Valor de referência deste catálogo: o golpe básico do bastão tira 3.
--                        O TBOTT_web ainda não tem dano de golpe; quando o combate existir, deve usar esse valor.
--   dano (damage)      = meios corações, como no TBOTT_web (1 = meio coração, 2 = um coração; o Tung Tung tem 6)
--   velocidade (speed) = unidades da sala por segundo, como no TBOTT_web (o Tung Tung anda a 260)

create table public.items (
  id text primary key,
  name text not null unique,
  -- Frase curta para o jogador: o que o item faz.
  description text not null,
  -- passivo = vale enquanto estiver com o jogador | consumivel = gasta ao usar
  type text not null,
  rarity text not null,
  -- Números do efeito, para balancear sem mexer no código. Cada item tem as suas chaves.
  effect jsonb not null default '{}'::jsonb,
  -- Tipos de sala em que o item aparece: os ids de ROOM_TYPES do TBOTT_web. Ex.: ["tesouro"]
  room_types jsonb not null default '[]'::jsonb,
  -- Preço na Loja, em grãos de café. Nulo = não é vendido.
  price smallint,
  -- Folha de animação do item e ícone parado.
  sprite_path text,
  icon_path text,
  created_at timestamptz not null default now(),

  constraint items_id_format check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint items_type_valid check (type in ('passivo', 'consumivel')),
  constraint items_rarity_valid check (rarity in ('comum', 'incomum', 'especial', 'raro')),
  constraint items_effect_is_object check (jsonb_typeof(effect) = 'object'),
  constraint items_room_types_is_array check (jsonb_typeof(room_types) = 'array'),
  constraint items_price_positive check (price > 0)
);

create table public.enemies (
  id text primary key,
  name text not null unique,
  -- Como o inimigo luta, em uma frase.
  description text,
  health smallint not null,
  damage smallint not null,
  speed smallint not null,
  -- Como o inimigo age (ex.: perseguir, atirar, vagar). É texto livre:
  -- um comportamento novo não exige migração, só o código dele no TBOTT_web.
  behavior text not null,
  -- Primeiro andar em que o inimigo pode aparecer (1 a 5).
  min_floor smallint not null,
  -- O inimigo é desenhado em duas camadas: pernas (atrás) e tronco (na frente).
  sprite_legs_path text,
  sprite_body_path text,
  created_at timestamptz not null default now(),

  constraint enemies_id_format check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint enemies_health_positive check (health > 0),
  constraint enemies_damage_positive check (damage > 0),
  constraint enemies_speed_not_negative check (speed >= 0),
  constraint enemies_behavior_format check (behavior ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint enemies_min_floor_valid check (min_floor between 1 and 5)
);

create table public.bosses (
  id text primary key,
  name text not null unique,
  -- Como o chefe luta, em uma frase.
  description text,
  health smallint not null,
  -- Dano de encostar no chefe. Cada ataque tem o próprio dano, em "attacks".
  damage smallint not null,
  -- Lista de ataques: [{ "id": "investida", "name": "Investida", "damage": 2 }].
  -- O "id" é o nome da animação do ataque no TBOTT_web (src/data/bossSprites.js).
  attacks jsonb not null default '[]'::jsonb,
  -- O chefe é sorteado entre os andares min_floor e max_floor. O chefe final tem os dois em 5.
  min_floor smallint not null,
  max_floor smallint not null,
  sprite_legs_path text,
  sprite_body_path text,
  created_at timestamptz not null default now(),

  constraint bosses_id_format check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint bosses_health_positive check (health > 0),
  constraint bosses_damage_positive check (damage > 0),
  constraint bosses_attacks_is_array check (jsonb_typeof(attacks) = 'array'),
  constraint bosses_floors_valid check (min_floor between 1 and 5 and max_floor between 1 and 5),
  constraint bosses_floors_in_order check (min_floor <= max_floor)
);


-- Segurança (RLS): pela Data API só o jogador logado lê o catálogo, e ninguém o altera.
-- Mudanças no catálogo são feitas apenas por migração ou seed.
alter table public.items enable row level security;
alter table public.enemies enable row level security;
alter table public.bosses enable row level security;

create policy "Jogador logado lê os itens"
  on public.items for select
  to authenticated
  using (true);

create policy "Jogador logado lê os inimigos"
  on public.enemies for select
  to authenticated
  using (true);

create policy "Jogador logado lê os chefes"
  on public.bosses for select
  to authenticated
  using (true);

revoke all on public.items, public.enemies, public.bosses from anon, authenticated;
grant select on public.items, public.enemies, public.bosses to authenticated;

-- Para desfazer (manualmente):
--   drop table if exists public.items, public.enemies, public.bosses;
