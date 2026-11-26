-- Migração 0007: personagens liberados de cada jogador.
-- 1) characters ganha starts_unlocked: o personagem que já começa liberado (o Tung Tung Sahur).
-- 2) character_unlocks guarda quais personagens bloqueados cada jogador já liberou.
--    A liberação é permanente: não existe rota para apagar, e um personagem não repete para o mesmo jogador.
-- A API não tem como conferir se o jogador pegou o Elixir ou venceu o jogo de verdade (como em POST /api/runs).

alter table public.characters
  add column starts_unlocked boolean not null default false;

-- O Sahur já começa liberado. Assim o jogo funciona mesmo antes de rodar "npm run db:seed".
update public.characters set starts_unlocked = true where id = 'tung-tung-sahur';

create table public.character_unlocks (
  user_id uuid not null references public.profiles (id) on delete cascade,
  character_id text not null references public.characters (id) on update cascade on delete cascade,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, character_id)
);

-- A chave primária já cobre user_id; character_id precisa de índice próprio (chave estrangeira).
create index character_unlocks_character_id_idx on public.character_unlocks (character_id);

-- Segurança (RLS): pela Data API o jogador só lê os próprios desbloqueios.
-- Liberar um personagem é feito apenas pela API, que usa o usuário da sessão.
alter table public.character_unlocks enable row level security;

create policy "Jogador lê seus próprios desbloqueios"
  on public.character_unlocks for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.character_unlocks from anon, authenticated;
grant select on public.character_unlocks to authenticated;

-- Para desfazer (manualmente):
--   drop table if exists public.character_unlocks;
--   alter table public.characters drop column if exists starts_unlocked;
