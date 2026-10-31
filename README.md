# TBOTT API

Backend do **The Binding of Tung Tung (TBOTT)**, jogo web roguelike inspirado em _The Binding of Isaac_. A API entrega o catálogo de personagens e o ranking, e guarda perfis e partidas. O front-end fica no [TBOTT_web](https://github.com/Victor-Hugo-Freire/TBOTT_web).

O **Supabase** hospeda o PostgreSQL, que a API acessa diretamente com `pg` e `DATABASE_URL`, e cuida da autenticação (cadastro, senha, confirmação de e-mail e sessões). A sessão do jogador fica em cookies `httpOnly`, gravados pela API.

**Tecnologias:** Node.js, Express 5, pg, Supabase JS (Auth), cors, cookie, ws, zod, dotenv, Swagger, node:test, PGlite (testes) e npm.

## Estrutura

```
db/migrations/   alterações do banco, em ordem (0001, 0002, ...)
db/seeds/        dados iniciais (personagens)
scripts/         comandos de banco: migração, seed e contas de teste
src/config/      variáveis de ambiente, conexão com o PostgreSQL e cliente do Supabase
src/routes/      declaração das rotas
src/middleware/  login obrigatório (requireAuth) e proteção contra CSRF (checkOrigin)
src/controller/  recebe a requisição e monta a resposta
src/service/     regras de negócio e validação
src/repository/  consultas SQL
src/utils/       erro padrão da API (AppError) e cookies de sessão
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

Para o login pelo navegador, duas variáveis importam (veja [Login, sessão e logout](#login-sessão-e-logout)):

- `FRONTEND_ORIGINS`: endereços do TBOTT_web, separados por vírgula. Em desenvolvimento, o padrão é `http://localhost:5173`. Em produção não há padrão: sem ela, nenhum navegador consegue usar a API.
- `NODE_ENV=production` liga o atributo `Secure` dos cookies, que passam a trafegar só por HTTPS.

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

| Rota                                     | Descrição                                                   | Exige login |
| ---------------------------------------- | ----------------------------------------------------------- | ----------- |
| `POST /api/auth/register`                | Cadastro de jogador (Supabase Auth + perfil)                | Não         |
| `POST /api/auth/login`                   | Login com e-mail e senha; grava os cookies de sessão        | Não         |
| `GET /api/auth/me`                       | Jogador logado (card de usuário do front-end)               | Sim         |
| `POST /api/auth/logout`                  | Encerra a sessão atual e apaga os cookies                   | Não         |
| `GET /api/characters`                    | Personagens ordenados por `display_order`                   | Não         |
| `GET /api/ranking?limit=50&offset=0`     | Melhor vitória de cada jogador, do menor para o maior tempo | Sim         |
| `POST /api/runs`                         | Registra o resultado de uma partida do jogador logado       | Sim         |
| `GET /health` e `GET /api/system/status` | Situação da API e do banco                                  | Não         |
| `/api` e `/api-docs`                     | Documentação e Swagger                                      | Não         |

No ranking, `limit` vai de 1 a 100 e `offset` começa em 0. O tempo vem em milissegundos (`durationMs`). Desempate: quem terminou primeiro. Parâmetros inválidos retornam 400, e banco indisponível retorna 503.

`POST /api/runs` recebe `{ "characterId": "tung-tung-sahur", "durationMs": 650000, "status": "victory" }` (`status`: `victory` ou `defeat`; tempo de 1 ms a 24 h). O jogador é sempre o da sessão: um `userId` no corpo é ignorado. Só `victory` entra no ranking. Responde `201 { run }`; erros: 400 (`INVALID_RUN_DATA`), 401, 403, 422 (`CHARACTER_NOT_FOUND`) e 503.

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

## Login, sessão e logout

O login é **só por e-mail e senha**, o fluxo nativo do Supabase Auth (`signInWithPassword`). Entrar pelo nome de usuário exigiria buscar o e-mail de outra pessoa a partir de um nome público, o que facilita descobrir contas. O protótipo também não pede isso.

1. `POST /api/auth/login` recebe `{ "email", "password" }`. O e-mail passa pela mesma normalização do cadastro (sem espaços nas pontas e em minúsculas); a senha vai como foi digitada.
2. Se o Supabase aceitar, a API confere se o perfil existe e grava a sessão em dois cookies `httpOnly`. A resposta traz só `{ "user": { "id", "email" }, "profile": { "id", "username" } }`. Os tokens nunca aparecem no JSON nem nos logs.
3. Depois disso, o navegador envia os cookies sozinho para as rotas `/api`. `GET /api/auth/me` devolve o mesmo `{ user, profile }` e é a rota do card de usuário.
4. `POST /api/auth/logout` encerra a sessão e apaga os cookies.

**Erros do login:** `400 INVALID_LOGIN_DATA` (com `details` por campo), `401 INVALID_CREDENTIALS` (a mesma resposta para senha errada e e-mail sem conta, para não revelar quem tem cadastro), `403 EMAIL_NOT_CONFIRMED` (o Supabase só informa isso depois de conferir a senha), `429 AUTH_RATE_LIMITED` e `503 SUPABASE_UNAVAILABLE`. A lista completa, com exemplos, está no Swagger.

### Cookies

| Cookie                | Conteúdo                                                          | Validade                                    |
| --------------------- | ----------------------------------------------------------------- | ------------------------------------------- |
| `tbott_access_token`  | JWT do Supabase: prova quem é o jogador                           | `expires_in` do Supabase (1 hora no padrão) |
| `tbott_refresh_token` | Troca-se por um par novo quando o access token vence (vale 1 vez) | 30 dias; o prazo recomeça a cada renovação  |

Atributos dos dois cookies:

- `HttpOnly`: o JavaScript da página não consegue lê-los (`document.cookie` não os mostra). Assim, um script malicioso injetado na página (XSS) não rouba os tokens.
- `Secure`: só com `NODE_ENV=production`. Em desenvolvimento a API usa `http://localhost`, e alguns navegadores recusam cookies `Secure` sem HTTPS.
- `SameSite=Lax`: o navegador não envia os cookies em requisições que outro site dispara por baixo dos panos (formulários, `fetch`). Configurável em `SESSION_COOKIE_SAMESITE`.
- `Path=/api`: os cookies só vão para as rotas da API. Não há `Domain`: o cookie fica preso ao endereço da API.

O Supabase não dá prazo ao refresh token; ele vale até ser usado ou a sessão acabar. Os 30 dias são o tempo que o navegador guarda o cookie: depois de 30 dias sem abrir o jogo, é preciso entrar de novo.

**Por que `SameSite=Lax` funciona em desenvolvimento:** `http://localhost:5173` e `http://localhost:8000` são origens diferentes (por isso o CORS), mas o mesmo **site**, porque a porta não conta para o `SameSite`. Abra o front-end por `localhost`, não por `127.0.0.1`: para o navegador, são sites diferentes. **Em produção**, publique o front-end e a API no mesmo site (por exemplo, `tbott.com.br` e `api.tbott.com.br`, ou a API em `/api` do mesmo domínio). Se ficarem em sites diferentes (domínios gratuitos como `*.vercel.app` contam como sites diferentes entre si), use `SESSION_COOKIE_SAMESITE=none`, que exige HTTPS. Navegadores que bloqueiam cookies de terceiros, como o Safari, podem recusar mesmo assim.

### Renovação da sessão

Em cada rota protegida, o middleware `requireAuth`:

1. lê os cookies; sem nenhum, responde `401 AUTH_SESSION_MISSING`;
2. confere o access token no Supabase Auth com `getUser`, que verifica assinatura, validade e se a sessão ainda existe. Por isso um logout vale na hora. Só decodificar o JWT na API não detectaria o logout;
3. se o access token venceu (ou o cookie dele já expirou), troca o refresh token por um par novo (`refreshSession`) e grava os cookies novos **na mesma resposta**;
4. se o Supabase recusar a sessão (token inválido, encerrado ou já usado), responde `401 AUTH_SESSION_EXPIRED` e apaga os cookies. Se o Supabase estiver fora do ar, responde `503` e **mantém** os cookies, porque a sessão pode continuar válida;
5. coloca o jogador em `req.user = { id, email }` para o controller.

Cada requisição usa um cliente do Supabase **próprio**. O cliente da biblioteca guarda a sessão dentro dele e junta renovações simultâneas sem olhar de quem é o token: um cliente único para a API inteira poderia entregar a sessão de um jogador a outro. Quando duas requisições do **mesmo** jogador chegam juntas com o token vencido, a API faz uma única renovação e entrega a mesma sessão para as duas, porque cada refresh token só pode ser trocado uma vez.

Respostas com dados do jogador ou com cookies de sessão levam `Cache-Control: private, no-store`, para nenhum cache (CDN ou proxy) entregar a sessão de um jogador a outro.

### Logout

Encerra no Supabase **só a sessão atual** (`scope: "local"`): o jogador continua logado em outros aparelhos. Se o access token já venceu, a API usa o refresh token só para conseguir encerrar a sessão; sem isso, o refresh token continuaria valendo no Supabase. A resposta é sempre `200 { "status": "logged_out" }` com os cookies apagados, também sem cookies ou com a sessão já vencida. Se o Supabase estiver fora do ar, os cookies são apagados mesmo assim e a falha fica no log.

### CORS e CSRF

- **CORS:** só as origens de `FRONTEND_ORIGINS` recebem `Access-Control-Allow-Origin` (sempre o endereço exato, nunca `*`) e `Access-Control-Allow-Credentials: true`. As consultas prévias do navegador (preflight, `OPTIONS`) são respondidas pela biblioteca `cors`.
- **CSRF:** o navegador envia os cookies sozinho, mesmo quando é outro site que dispara a requisição. O CORS só impede o outro site de **ler** a resposta; um formulário HTML, por exemplo, chega à API sem pedir permissão. Por isso, em `POST`, `PUT`, `PATCH` e `DELETE`, o middleware `checkOrigin` confere o cabeçalho `Origin` (que a página não consegue falsificar) e aceita só: o TBOTT_web, páginas da própria API (o Swagger) e requisições sem `Origin`, que não vêm de navegador (curl, PowerShell, Postman). O resto recebe `403 ORIGIN_NOT_ALLOWED`. O `SameSite=Lax` é uma segunda barreira.

### Como o front-end usa a sessão

Toda chamada que precisa da sessão (login, `me`, logout e as rotas protegidas) deve usar `credentials: 'include'`. Sem isso, o navegador não grava nem envia os cookies entre `localhost:5173` e `localhost:8000`:

```js
await fetch(`${API_URL}/api/auth/login`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password })
});
```

No TBOTT_web, basta acrescentar `credentials: 'include'` ao `fetch` de `src/services/api.js`. O front-end não guarda token nenhum (nada de `localStorage`): para saber se o jogador está logado, chame `GET /api/auth/me`. Qualquer `401` significa "deslogado".

### Rotas que exigem login

Passe o middleware no registro da rota. O controller recebe o jogador em `req.user`, já conferido no Supabase:

```js
registerRoute({
  app,
  method: 'POST',
  path: '/api/runs',
  auth: 'Sessão (cookies)',
  middlewares: [requireAuth],
  handler: createRunController // usa req.user.id, que é o mesmo id de public.profiles
});
```

Rotas públicas, como os personagens, continuam sem o middleware. O ranking também exige login: sem sessão, a resposta é `401 AUTH_SESSION_MISSING`.

### Limitações conhecidas

- O `getUser` faz uma chamada ao Supabase Auth em cada requisição protegida. A alternativa mais rápida, `getClaims` (verificação local do JWT), não percebe um logout antes de o token vencer.
- Depois do logout, o access token continua aceito até vencer por quem confere só a assinatura (como a Data API do Supabase). A API não aceita, porque usa `getUser`.
- Se o Supabase estiver fora do ar durante uma renovação, a biblioteca tenta de novo por até cerca de 30 segundos antes de a API responder `503`.
- A renovação única para requisições simultâneas vale dentro de um processo da API. Com várias instâncias, o Supabase tolera o reenvio do refresh token anterior (devolve o token ativo), conforme a documentação de sessões.

## Executar e testar

```powershell
npm run dev
npm test
```

Com a API rodando, em outro terminal:

```powershell
Invoke-RestMethod http://localhost:8000/api/characters | ConvertTo-Json -Depth 5
# O ranking exige login: teste pelo Swagger (faça o login antes) ou pelo front-end.
```

`npm test` usa um PostgreSQL em memória (PGlite) e um Supabase Auth simulado. Não precisa de credenciais e não toca no banco nem no Supabase reais: os testes de autenticação ignoram o `.env` e usam endereços falsos. Nos testes de login e sessão, o Auth simulado roda na rede local (`tests/helpers/fakeAuthServer.js`) e a API usa o cliente `supabase-js` de verdade contra ele. Os testes cobrem migrações, seed, RLS, a proteção de `schema_migrations`, o ranking, o cadastro (validação, erros HTTP, e-mail repetido e disputa pelo mesmo nome) e a sessão (login, cookies, renovação, logout, requisições simultâneas, CORS e CSRF).

**Testar o login pelo Swagger:** abra `http://localhost:8000/api-docs` (com `localhost`, o mesmo endereço da API), faça o login e depois chame `GET /api/auth/me`. O navegador guarda e envia os cookies sozinho. O Swagger não mostra o `Set-Cookie`: confira os cookies em F12 → _Application_ → _Cookies_ → `http://localhost:8000`. Para testar a renovação sem esperar 1 hora, apague só o cookie `tbott_access_token` ali e chame `/api/auth/me` de novo: a resposta é `200` e os dois cookies são regravados. O Swagger roda no mesmo endereço da API; o fluxo real do front-end (outra porta, CORS e `credentials: 'include'`) precisa ser conferido também pelo TBOTT_web.

Para conferir o banco no SQL Editor do Supabase:

```sql
select version, applied_at from public.schema_migrations order by version;
select tablename, rowsecurity from pg_tables where schemaname = 'public';
```

## Pendências

- TBOTT_web: acrescentar `credentials: 'include'` ao `fetch` de `src/services/api.js` e criar a tela de login e o card de usuário.
- Cadastro: reenviar o e-mail de confirmação e trocar o nome de usuário (útil quando o banco grava um nome provisório).
- `sprite_path` fica nulo até o sprite estar no TBOTT_web. Os outros dois personagens e os atributos entram quando forem definidos.

## Como criar uma rota

Declare a rota com `registerRoute`, ligue-a a um controller (e, se precisar, a service e repository) e registre o módulo em `src/app.js`. O catálogo e o Swagger são gerados a partir do mesmo registro. Para exigir login, passe `middlewares: [requireAuth]` (veja [Rotas que exigem login](#rotas-que-exigem-login)).
