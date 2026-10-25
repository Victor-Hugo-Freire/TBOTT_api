-- Migração 0003: partidas (runs) dos jogadores
--
-- O ranking é calculado a partir desta tabela: vence quem terminou a run (vitória) no menor tempo.
-- A duração é guardada em MILISSEGUNDOS (duration_ms), em toda a aplicação.

create table public.game_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  character_id text not null references public.characters (id) on update cascade on delete restrict,
  -- in_progress = em andamento | victory = completou todas as fases vivo | defeat = morreu
  status text not null default 'in_progress',
  duration_ms integer,
  started_at timestamptz not null default now(),
  finished_at timestamptz,

  constraint game_runs_status_valid check (status in ('in_progress', 'victory', 'defeat')),
  constraint game_runs_duration_positive check (duration_ms > 0),
  constraint game_runs_finished_after_start check (finished_at >= started_at),
  -- Run em andamento ainda não tem fim nem duração; run encerrada precisa ter os dois.
  constraint game_runs_finished_fields check (
    (status = 'in_progress' and finished_at is null and duration_ms is null)
    or (status <> 'in_progress' and finished_at is not null and duration_ms is not null)
  )
);

-- Índices das chaves estrangeiras (consultas por jogador e exclusões em cascata).
create index game_runs_user_id_idx on public.game_runs (user_id);
create index game_runs_character_id_idx on public.game_runs (character_id);

-- Índice parcial para o ranking: só runs vencidas, do menor para o maior tempo de cada jogador.
create index game_runs_ranking_idx on public.game_runs (user_id, duration_ms, finished_at)
  where status = 'victory';


-- Segurança (RLS): pela Data API o jogador só lê as próprias runs.
-- Registrar ou alterar runs é feito apenas pela API, que valida o usuário da sessão
-- e os dados enviados. O ranking público é servido pela API (GET /api/ranking).
alter table public.game_runs enable row level security;

create policy "Jogador lê as próprias runs"
  on public.game_runs for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.game_runs from anon, authenticated;
grant select on public.game_runs to authenticated;

-- Para desfazer (manualmente):
--   drop table if exists public.game_runs;
