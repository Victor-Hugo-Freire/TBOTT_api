-- Migração 0005: progresso salvo do jogador.
-- O conteúdo é genérico (JSONB), sem campos fixos de gameplay ao longo da issue.
-- Há no máximo um registro por usuário, então a chave primária é user_id.

create table public.player_progress (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index player_progress_updated_at_idx on public.player_progress (updated_at desc);

alter table public.player_progress enable row level security;

create policy "Jogador lê seu próprio progresso"
  on public.player_progress for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Jogador cria seu próprio progresso"
  on public.player_progress for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Jogador atualiza seu próprio progresso"
  on public.player_progress for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.player_progress from anon, authenticated;
grant select, insert, update on public.player_progress to authenticated;
