-- Migração 0005: progresso salvo do jogador (botão "Continue" do menu).
-- O conteúdo é livre (JSONB): andar, sala, itens, grãos e garfos ainda não têm formato fechado.
-- Há no máximo um registro por usuário, então a chave primária é user_id.
-- Começar outra run substitui o registro; registrar o fim da run (POST /api/runs) o apaga.

create table public.player_progress (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Segurança (RLS): pela Data API o jogador só lê o próprio progresso.
-- Salvar ou apagar o progresso é feito apenas pela API, que usa o usuário da sessão.
alter table public.player_progress enable row level security;

create policy "Jogador lê seu próprio progresso"
  on public.player_progress for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.player_progress from anon, authenticated;
grant select on public.player_progress to authenticated;

-- Para desfazer (manualmente):
--   drop table if exists public.player_progress;
