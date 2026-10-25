-- Migração 0001: perfis dos jogadores
--
-- E-mail, senha e confirmação de e-mail ficam no Supabase Auth (tabela auth.users).
-- Aqui guardamos apenas o que o jogo precisa: o nome de usuário exibido no card e no ranking.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  created_at timestamptz not null default now(),

  -- Regra provisória: 3 a 20 caracteres, apenas letras, números e "_".
  constraint profiles_username_format check (username ~ '^[A-Za-z0-9_]{3,20}$')
);

-- Nome único sem diferenciar maiúsculas de minúsculas: "Jogador" e "jogador" são o mesmo nome.
create unique index profiles_username_lower_key on public.profiles (lower(username));


-- Segurança (RLS) para acessos feitos pela Data API do Supabase (papéis anon e authenticated).
-- A API Node conecta como "postgres", que ignora RLS; por isso ela também valida tudo no código.
alter table public.profiles enable row level security;

create policy "Jogador lê o próprio perfil"
  on public.profiles for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Jogador altera o próprio perfil"
  on public.profiles for update
  to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Não há políticas de insert e delete: o perfil é criado pelo gatilho abaixo
-- e apagado em cascata quando a conta é removida no Supabase Auth.
-- Além disso, o jogador só pode alterar a coluna username.
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (username) on public.profiles to authenticated;


-- Gatilho: cria o perfil automaticamente quando uma conta nova é criada no Supabase Auth.
-- O nome de usuário vem dos metadados do cadastro: signUp({ options: { data: { username } } }).
create function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text := new.raw_user_meta_data ->> 'username';
begin
  if requested_username ~ '^[A-Za-z0-9_]{3,20}$' then
    insert into public.profiles (id, username)
    values (new.id, requested_username)
    on conflict do nothing;

    if found then
      return new;
    end if;
  end if;

  -- Nome ausente, inválido ou já usado: gera um nome provisório para não bloquear o cadastro.
  -- O jogador pode trocá-lo depois. Ex.: jogador_3f2a9c1d04b7
  insert into public.profiles (id, username)
  values (new.id, 'jogador_' || left(replace(new.id::text, '-', ''), 12));

  return new;
end;
$$;

revoke execute on function public.handle_new_auth_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();

-- Para desfazer (manualmente):
--   drop trigger if exists on_auth_user_created on auth.users;
--   drop function if exists public.handle_new_auth_user();
--   drop table if exists public.profiles;
