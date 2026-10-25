import { getDatabasePool } from '../config/database.js';

// Ranking: o melhor tempo (menor duration_ms) de cada jogador, considerando só vitórias.
// Desempate: quem terminou primeiro (finished_at) e, por último, o id da run.
export const findRanking = async ({ limit, offset }, db = getDatabasePool()) => {
  const result = await db.query(`
    with best_runs as (
      -- distinct on mantém só a primeira linha de cada jogador, ou seja, a sua melhor run.
      select distinct on (user_id)
        id, user_id, character_id, duration_ms, finished_at
      from public.game_runs
      where status = 'victory'
      order by user_id, duration_ms, finished_at, id
    )
    select
      (row_number() over (order by best_runs.duration_ms, best_runs.finished_at, best_runs.id))::int as position,
      profiles.username,
      characters.id as character_id,
      characters.name as character_name,
      best_runs.duration_ms,
      best_runs.finished_at
    from best_runs
    join public.profiles on profiles.id = best_runs.user_id
    join public.characters on characters.id = best_runs.character_id
    order by position
    limit $1 offset $2
  `, [limit, offset]);

  return result.rows;
};
