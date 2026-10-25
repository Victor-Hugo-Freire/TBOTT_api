-- Simulação MÍNIMA do que o Supabase já tem pronto, usada somente nos testes locais (PGlite).
-- Não é executada no banco real.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;

create schema auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- No Supabase, auth.uid() lê o "sub" do JWT do usuário. Aqui lemos de uma configuração de sessão.
create function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

grant usage on schema auth to anon, authenticated, supabase_auth_admin;
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, delete on auth.users to supabase_auth_admin;

-- Como no Supabase: tabelas novas em public recebem privilégios para anon, authenticated e service_role.
-- Por isso as migrações precisam usar RLS e revoke.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
