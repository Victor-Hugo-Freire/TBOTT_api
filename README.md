# TBOTT API

Backend do **The Binding of Tung Tung (TBOTT)**, jogo web roguelike inspirado em _The Binding of Isaac_. A API entrega o catálogo de personagens e o ranking, e guarda perfis e partidas. O front-end fica no [TBOTT_web](https://github.com/Victor-Hugo-Freire/TBOTT_web).

O **Supabase** hospeda o PostgreSQL, que a API acessa diretamente com `pg` e `DATABASE_URL`, e cuida da autenticação (cadastro, senha e confirmação de e-mail).

**Tecnologias:** Node.js, Express 5, pg, Supabase JS (Auth), ws, zod, dotenv, Swagger, node:test, PGlite (testes) e npm.

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
src/utils/       erro padrão da API (AppError)
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
| `POST /api/auth/register`                | Cadastro de jogador (Supabase Auth + perfil)                |
| `GET /api/characters`                    | Personagens ordenados por `display_order`                   |
| `GET /api/ranking?limit=50&offset=0`     | Melhor vitória de cada jogador, do menor para o maior tempo |
| `GET /health` e `GET /api/system/status` | Situação da API e do banco                                  |
| `/api` e `/api-docs`                     | Documentação e Swagger                                      |

No ranking, `limit` vai de 1 a 100 e `offset` começa em 0. O tempo vem em milissegundos (`durationMs`). Desempate: quem terminou primeiro. Parâmetros inválidos retornam 400, e banco indisponível retorna 503.

## Cadastro de jogador

`POST /api/auth/register` recebe `{ "username", "email", "password" }` e usa `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`.

1. Valida os dados: nome com a mesma regra do banco; senha de 8 a 72 caracteres, sem ser só espaços.
2. Recusa um nome já usado (sem diferenciar maiúsculas) **antes** de criar a conta.
3. Cria a conta com `supabase.auth.signUp`. O gatilho `on_auth_user_created` cria o perfil na mesma transação, com o mesmo id.
4. Responde `201`:

```json
{
  "status": "pending_email_confirmation",
  "requiresEmailConfirmation": true,
  "usernameChanged": false,
  "user": { "id": "0b7f6c1e-...", "email": "jogador.teste@example.com" },
  "profile": { "id": "0b7f6c1e-...", "username": "jogador_123" }
}
```

- `status` é `registered` quando a confirmação de e-mail está desligada. A API nunca devolve tokens.
- `usernameChanged: true` significa que o nome pedido não foi mantido: outro cadastro ocupou o nome no mesmo instante e o banco gravou `jogador_<hex>`, ou o e-mail já tinha um cadastro pendente com outro nome. Mostre sempre `profile.username`.

**Erros** vêm como `{ "error": "mensagem", "code": "CODIGO", "details": [...] }`. O campo `error` tem o mesmo papel que nas outras rotas; `code` e `details` são extras do cadastro. Em erros 5xx a mensagem é sempre genérica e o detalhe fica só no log. A lista de códigos está no Swagger.

**E-mail repetido.** Com "Confirm email" ligado, o Supabase não avisa que o e-mail já existe: devolve um usuário falso (`identities: []`), para esconder quem tem conta. Por decisão do projeto, a API reconhece esse caso e responde `409 AUTH_USER_ALREADY_EXISTS`, igual a quando a confirmação está desligada. A consequência é que o endpoint revela se um e-mail tem conta.

**Configuração no painel do Supabase (Authentication):**

- _Confirm email_: ligado no projeto da equipe. Num projeto de testes pode ser desligado.
- _URL Configuration → Site URL_: para onde o link de confirmação leva. Use o endereço do TBOTT_web (em desenvolvimento, `http://localhost:5173`). O front ainda não tem tela de retorno, mas a conta é confirmada ao abrir o link, antes do redirecionamento.
- O SMTP padrão só envia e-mails para membros da organização do Supabase e tem um limite baixo por hora. Para outros endereços, configure um SMTP próprio. Domínios de exemplo, como `example.com`, são recusados.
- **Limite de e-mails:** com a confirmação ligada, cada cadastro novo envia um e-mail. O SMTP padrão permite poucos e-mails por hora para o projeto inteiro (o número fica em _Authentication → Rate Limits_), e o mesmo endereço só pode receber outro e-mail depois de 60 segundos. Ao passar do limite, a API responde `429 AUTH_RATE_LIMITED`. Nos testes manuais, deixe a confirmação desligada e ligue só para testar o e-mail de confirmação.

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

`npm test` usa um PostgreSQL em memória (PGlite) e, no cadastro, um Supabase Auth simulado. Não precisa de credenciais e não toca no banco nem no Supabase reais: os testes do cadastro ignoram o `.env` e usam endereços falsos. Os testes cobrem migrações, seed, RLS, a proteção de `schema_migrations`, o ranking e o cadastro (validação, erros HTTP, e-mail repetido e disputa pelo mesmo nome).

Para conferir o banco no SQL Editor do Supabase:

```sql
select version, applied_at from public.schema_migrations order by version;
select tablename, rowsecurity from pg_tables where schemaname = 'public';
```

## Pendências

- Login, sessão e a rota que registra partidas pertencem às issues #8 e #9.
- Cadastro: reenviar o e-mail de confirmação e trocar o nome de usuário (útil quando o banco grava um nome provisório).
- CORS, para o TBOTT_web chamar a API pelo navegador.
- `sprite_path` fica nulo até o sprite estar no TBOTT_web. Os outros dois personagens e os atributos entram quando forem definidos.

## Como criar uma rota

Declare a rota com `registerRoute`, ligue-a a um controller (e, se precisar, a service e repository) e registre o módulo em `src/app.js`. O catálogo e o Swagger são gerados a partir do mesmo registro.
