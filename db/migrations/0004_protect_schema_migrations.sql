-- Migração 0004: protege a tabela de controle das migrações
--
-- public.schema_migrations guarda quais migrações já foram aplicadas. Ela só deve ser
-- usada pelo executor (npm run db:migrate), que conecta como "postgres", dono da tabela.
--
-- No Supabase, tabelas novas em public recebem privilégios automáticos para anon,
-- authenticated e service_role. O RLS sem políticas já esconde as linhas, mas os
-- privilégios ainda deixariam a tabela visível na Data API. Por isso removemos os dois acessos.
--
-- O dono (postgres) não é afetado pelo revoke. Nenhum registro do histórico é alterado.
-- Pode ser executado de novo sem efeito colateral.

revoke all privileges
on table public.schema_migrations
from anon, authenticated, service_role, public;

alter table public.schema_migrations
enable row level security;
