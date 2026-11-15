-- Seed 0003: catálogo de inimigos
--
-- Pode ser executado várias vezes: se o inimigo já existir, os dados são atualizados (upsert).
-- Este arquivo é a fonte oficial dos inimigos. Para rebalancear, mude o número aqui e rode
-- "npm run db:seed".
--
-- Unidades:
--   health    = vida em pontos. Valor de referência deste catálogo: o golpe básico do bastão
--               tira 3 (vida 9 = 3 golpes). O TBOTT_web ainda não tem dano de golpe: quando o
--               combate existir, deve usar esse valor (ou a vida daqui muda junto).
--   damage    = meios corações (1 = meio coração, 2 = um coração; o Tung Tung tem 6).
--   speed     = unidades da sala por segundo (o Tung Tung anda a 260).
--   min_floor = primeiro andar em que o inimigo pode aparecer.
-- Os números são a primeira proposta de balanceamento: nenhum inimigo existe no jogo ainda.
-- O Pinguino tem 3 golpes de vida porque o sprite mostra 3 bolas de sorvete.

insert into public.enemies (id, name, description, health, damage, speed, behavior, min_floor, sprite_legs_path, sprite_body_path)
values
  (
    'formaggino-saltellino', 'Formaggino Saltellino',
    'Persegue aos saltos: agacha, pula e morde.',
    6, 1, 150, 'perseguir', 1,
    '/sprites/enemies/formaggino-saltellino/formaggino-saltellino-pernas.png',
    '/sprites/enemies/formaggino-saltellino/formaggino-saltellino-tronco.png'
  ),
  (
    'pistacchio-sputacchio', 'Pistacchio Sputacchio',
    'Abre a casca e cospe um caroço.',
    6, 1, 90, 'atirar', 1,
    '/sprites/enemies/pistacchio-sputacchio/pistacchio-sputacchio-pernas.png',
    '/sprites/enemies/pistacchio-sputacchio/pistacchio-sputacchio-tronco.png'
  ),
  (
    'zanzarina-tarantella', 'Zanzarina Tarantella',
    'Dança no ar e mergulha com o ferrão.',
    3, 1, 200, 'vagar', 1,
    '/sprites/enemies/zanzarina-tarantella/zanzarina-tarantella-pernas.png',
    '/sprites/enemies/zanzarina-tarantella/zanzarina-tarantella-tronco.png'
  ),
  (
    'cannolo-carica', 'Cannolo Carica',
    'Raspa o pé, investe em linha reta e fica atordoado.',
    9, 1, 120, 'investir', 2,
    '/sprites/enemies/cannolo-carica/cannolo-carica-pernas.png',
    '/sprites/enemies/cannolo-carica/cannolo-carica-tronco.png'
  ),
  (
    'pinguino-sorbettino', 'Pinguino Sorbettino',
    'Desliza de barriga em linha reta e deixa um rastro escorregadio. Cada golpe derruba uma bola de sorvete.',
    9, 1, 140, 'investir', 2,
    '/sprites/enemies/pinguino-sorbettino/pinguino-sorbettino-pernas.png',
    '/sprites/enemies/pinguino-sorbettino/pinguino-sorbettino-tronco.png'
  ),
  (
    'polpetta-sotterranea', 'Polpetta Sotterranea',
    'Fica escondida no molho, emerge mordendo e afunda de novo.',
    9, 1, 100, 'emboscar', 2,
    '/sprites/enemies/polpetta-sotterranea/polpetta-sotterranea-pernas.png',
    '/sprites/enemies/polpetta-sotterranea/polpetta-sotterranea-tronco.png'
  ),
  (
    'fenicottero-fornarino', 'Fenicottero Fornarino',
    'Lança uma pizza em arco, que deixa queijo quente onde cai.',
    9, 2, 70, 'atirar', 3,
    '/sprites/enemies/fenicottero-fornarino/fenicottero-fornarino-pernas.png',
    '/sprites/enemies/fenicottero-fornarino/fenicottero-fornarino-tronco.png'
  ),
  (
    'vespina-lambrettina', 'Vespina Lambrettina',
    'Acelera soltando fumaça, faz curvas fechadas e dá a ferroada em mergulho.',
    6, 1, 240, 'investir', 3,
    '/sprites/enemies/vespina-lambrettina/vespina-lambrettina-pernas.png',
    '/sprites/enemies/vespina-lambrettina/vespina-lambrettina-tronco.png'
  ),
  (
    'moka-scudiera', 'Moka Scudiera',
    'Apita soltando um anel de vapor e protege os aliados com um escudo de vapor.',
    12, 1, 100, 'proteger', 3,
    '/sprites/enemies/moka-scudiera/moka-scudiera-pernas.png',
    '/sprites/enemies/moka-scudiera/moka-scudiera-tronco.png'
  ),
  (
    'peperoncino-kamikaze', 'Peperoncino Kamikaze',
    'Corre até o jogador, acende, pisca e explode.',
    3, 2, 230, 'explodir', 4,
    '/sprites/enemies/peperoncino-kamikaze/peperoncino-kamikaze-pernas.png',
    '/sprites/enemies/peperoncino-kamikaze/peperoncino-kamikaze-tronco.png'
  )
on conflict (id) do update
set
  name = excluded.name,
  description = excluded.description,
  health = excluded.health,
  damage = excluded.damage,
  speed = excluded.speed,
  behavior = excluded.behavior,
  min_floor = excluded.min_floor,
  sprite_legs_path = excluded.sprite_legs_path,
  sprite_body_path = excluded.sprite_body_path;
