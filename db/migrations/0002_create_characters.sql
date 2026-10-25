-- Migração 0002: catálogo fixo de personagens jogáveis
--
-- Os personagens não mudam a cada partida; os dados ficam em db/seeds/0001_characters.sql.
-- Atributos iniciais (vida, dano etc.) serão adicionados em uma nova migração
-- quando os valores forem definidos pela equipe.

create table public.characters (
  -- Identificador estável e legível, usado nas runs e no front-end. Ex.: 'tung-tung-sahur'
  id text primary key,
  name text not null unique,
  description text,
  -- Referência ao arquivo do sprite (caminho no front-end ou URL). A imagem não fica no banco.
  sprite_path text,
  -- Ordem dos cartões na tela de seleção de personagem.
  display_order smallint not null,
  created_at timestamptz not null default now(),

  constraint characters_id_format check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint characters_display_order_positive check (display_order > 0)
);


-- Segurança (RLS): qualquer pessoa pode ler o catálogo; ninguém altera pela Data API.
-- Mudanças no catálogo são feitas apenas por migração ou seed.
alter table public.characters enable row level security;

create policy "Catálogo de personagens é público"
  on public.characters for select
  to anon, authenticated
  using (true);

revoke all on public.characters from anon, authenticated;
grant select on public.characters to anon, authenticated;

-- Para desfazer (manualmente):
--   drop table if exists public.characters;
