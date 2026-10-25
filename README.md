# TBOTT API

Backend do **The Binding of Tung Tung (TBOTT)**, jogo web roguelike inspirado em _The Binding of Isaac_. A API entrega o catálogo de personagens e o ranking, e guarda perfis e partidas. O front-end fica no [TBOTT_web](https://github.com/Victor-Hugo-Freire/TBOTT_web).

O **Supabase** hospeda o PostgreSQL, que a API acessa diretamente com `pg` e `DATABASE_URL`, e cuida da autenticação (cadastro, senha e confirmação de e-mail).

**Tecnologias:** Node.js, Express 5, pg, zod, dotenv, Swagger, node:test, PGlite (testes) e npm.

## Estrutura

```
db/migrations/   alterações do banco, em ordem (0001, 0002, ...)
db/seeds/        dados iniciais (personagens)
scripts/         comandos de banco: migração, seed e contas de teste
src/config/      variáveis de ambiente e conexão com o PostgreSQL
src/routes/      declaração das rotas
src/controller/  recebe a requisição e monta a resposta
src/service/     regras de negócio e validação
src/repository/  consultas SQL
src/docs/        catálogo de rotas e Swagger
tests/           testes automatizados
```

## Configuração

Requer Node.js 20 ou superior (testado com o 24).

```powershell
cd TBOTT_api
npm install
Copy-Item .env.example .env
```

O arquivo `.env` contém as configurações necessárias para conectar a API ao banco de dados e deve ficar apenas com os integrantes da equipe, sem ser enviado ao GitHub. O `.env.example` serve como modelo para configurar essas variáveis. As credenciais secretas devem ficar apenas na API, nunca no front-end.

## Banco de dados

```powershell
npm run db:migrate   # aplica só as migrações pendentes
npm run db:seed      # cadastra/atualiza os personagens sem duplicar
```

Os dois comandos podem ser executados de novo com segurança. Para mudar o banco, crie o próximo arquivo numerado em `db/migrations/`. Nunca edite uma migração já aplicada.

| Tabela              | Conteúdo                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles`          | Perfil do jogador ligado a `auth.users`. O `username` é único sem diferenciar maiúsculas, e o perfil é criado por um gatilho no cadastro. |
| `characters`        | Catálogo fixo: `id` estável, nome, descrição, `sprite_path` e `display_order`.                                                            |
| `game_runs`         | Partidas: jogador, personagem, `status` (`in_progress`, `victory` ou `defeat`) e `duration_ms`.                                           |
| `schema_migrations` | Migrações já aplicadas. Só o dono (`postgres`) tem acesso.                                                                                |

**Segurança.** O RLS está ativo em todas as tabelas:

- o catálogo é público;
- o jogador lê e altera só os próprios dados;
- runs só são gravadas pela API.

A API conecta como `postgres`, que **ignora o RLS**. Por isso, as rotas precisam usar sempre o usuário da sessão e validar os dados recebidos.

**Sprites.** O banco guarda só a referência (`sprite_path`). Os arquivos ficaram no TBOTT_web.

## Endpoints

| Rota                                     | Descrição                                                   |
| ---------------------------------------- | ----------------------------------------------------------- |
| `GET /api/characters`                    | Personagens ordenados por `display_order`                   |
| `GET /api/ranking?limit=50&offset=0`     | Melhor vitória de cada jogador, do menor para o maior tempo |
| `GET /health` e `GET /api/system/status` | Situação da API e do banco                                  |
| `/api` e `/api-docs`                     | Documentação e Swagger                                      |

No ranking, `limit` vai de 1 a 100 e `offset` começa em 0. O tempo vem em milissegundos (`durationMs`). Desempate: quem terminou primeiro. Parâmetros inválidos retornam 400, e banco indisponível retorna 503.

## Executar e testar

```powershell
npm run dev
npm test
```

Com a API rodando, em outro terminal:

```powershell
Invoke-RestMethod http://localhost:8000/api/characters | ConvertTo-Json -Depth 5
Invoke-RestMethod "http://localhost:8000/api/ranking?limit=10" | ConvertTo-Json -Depth 5
```

`npm test` usa um PostgreSQL em memória (PGlite). Não precisa de credenciais e não toca no banco real. Os testes cobrem migrações, seed, RLS, a proteção de `schema_migrations` e o ranking.

Para conferir o banco no SQL Editor do Supabase:

```sql
select version, applied_at from public.schema_migrations order by version;
select tablename, rowsecurity from pg_tables where schemaname = 'public';
```

## Pendências

- Cadastro, login, sessão e a rota que registra partidas pertencem às issues #7, #8 e #9.
- `sprite_path` fica nulo até o sprite estar no TBOTT_web. Os outros dois personagens e os atributos entram quando forem definidos.

## Como criar uma rota

Declare a rota com `registerRoute`, ligue-a a um controller (e, se precisar, a service e repository) e registre o módulo em `src/app.js`. O catálogo e o Swagger são gerados a partir do mesmo registro.
