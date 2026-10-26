import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

const toBase64Url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');

// Supabase Auth simulado NA REDE (127.0.0.1, porta livre), para os testes de login e sessão.
// A API cria os clientes supabase-js de verdade apontando para ele (via SUPABASE_URL), então
// os testes também conferem como a biblioteca interpreta cada resposta. Rotas e erros seguem
// o servidor do Supabase Auth (token.go, auth.go, logout.go) e a documentação de sessões:
// - POST /auth/v1/token?grant_type=password: login. E-mail sem conta e senha errada dão o mesmo
//   erro (invalid_credentials); email_not_confirmed só aparece com a senha certa;
// - GET /auth/v1/user: aceita o access token só se ele não venceu e a sessão ainda existe;
// - POST /auth/v1/token?grant_type=refresh_token: troca o refresh token por um par novo. Cada
//   refresh token vale uma vez. Reapresentar o "pai" do token ativo devolve o ativo; qualquer
//   outro reuso encerra a sessão inteira (refresh_token_already_used);
// - POST /auth/v1/logout?scope=local|global: encerra a sessão do token (ou todas, em global).
// Simplificação: o intervalo de reuso de 10 segundos do Supabase não é simulado.
export const startFakeAuthServer = async ({ expiresIn = 3600 } = {}) => {
  const accounts = new Map();      // e-mail -> { id, email, password, confirmed }
  const sessions = new Map();      // id da sessão -> { userId, activeRefreshToken }
  const accessTokens = new Map();  // access token -> { sessionId, expiresAt (ms) }
  const refreshTokens = new Map(); // refresh token -> { sessionId, replacedBy }
  const issuedTokens = new Set();  // todos os tokens já emitidos (para procurar vazamentos)
  const requests = [];             // chamadas recebidas, sem tokens: { endpoint, scope, apikey, bearer }
  const failures = [];             // status das próximas respostas com falha (Supabase fora do ar)
  let refreshBarrier = null;       // segura as renovações até chegar o número esperado

  const send = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'x-supabase-api-version': '2024-01-01' });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };

  // Formato dos erros do Supabase Auth para clientes que pedem a versão 2024-01-01 da API.
  const sendError = (res, status, code, msg) => send(res, status, { code, msg });

  const accountById = (userId) => [...accounts.values()].find((account) => account.id === userId);

  const toUserJson = (account) => ({
    id: account.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: account.email,
    email_confirmed_at: account.confirmed ? '2026-10-25T12:00:00Z' : null,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: '2026-10-25T12:00:00Z',
    updated_at: '2026-10-25T12:00:00Z'
  });

  const createRefreshToken = (sessionId) => {
    const token = randomBytes(16).toString('base64url');
    refreshTokens.set(token, { sessionId, replacedBy: null });
    sessions.get(sessionId).activeRefreshToken = token;
    issuedTokens.add(token);
    return token;
  };

  // Resposta de sessão: um access token novo (no formato de um JWT) + o refresh token ativo.
  const sessionResponse = (sessionId) => {
    const session = sessions.get(sessionId);
    const account = accountById(session.userId);
    const expiresAt = Math.floor(Date.now() / 1000) + expiresIn;
    const accessToken = [
      toBase64Url({ alg: 'HS256', typ: 'JWT' }),
      toBase64Url({ sub: account.id, session_id: sessionId, role: 'authenticated', exp: expiresAt }),
      randomBytes(16).toString('base64url')
    ].join('.');

    accessTokens.set(accessToken, { sessionId, expiresAt: expiresAt * 1000 });
    issuedTokens.add(accessToken);

    return {
      access_token: accessToken,
      token_type: 'bearer',
      expires_in: expiresIn,
      expires_at: expiresAt,
      refresh_token: session.activeRefreshToken,
      user: toUserJson(account)
    };
  };

  const endSession = (sessionId) => {
    sessions.delete(sessionId);

    for (const [token, stored] of refreshTokens) {
      if (stored.sessionId === sessionId) {
        refreshTokens.delete(token);
      }
    }
  };

  // Mesma ordem do servidor real: token ausente (401), inválido ou vencido (403 bad_jwt) e
  // sessão que não existe mais (403 session_not_found, por exemplo depois de um logout).
  const authenticate = (req) => {
    const header = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) {
      return { error: [401, 'no_authorization', 'This endpoint requires a valid Bearer token'] };
    }

    const stored = accessTokens.get(header.slice('Bearer '.length));
    if (!stored) {
      return { error: [403, 'bad_jwt', 'invalid JWT: unable to parse or verify signature, token is malformed'] };
    }

    if (stored.expiresAt <= Date.now()) {
      return { error: [403, 'bad_jwt', 'invalid JWT: unable to parse or verify signature, token has invalid claims: token is expired'] };
    }

    if (!sessions.has(stored.sessionId)) {
      return { error: [403, 'session_not_found', 'Session from session_id claim in JWT does not exist'] };
    }

    return { sessionId: stored.sessionId };
  };

  const passwordGrant = (res, { email, password }) => {
    const account = accounts.get(email);

    if (!account || account.password !== password) {
      return sendError(res, 400, 'invalid_credentials', 'Invalid login credentials');
    }

    if (!account.confirmed) {
      return sendError(res, 400, 'email_not_confirmed', 'Email not confirmed');
    }

    const sessionId = randomUUID();
    sessions.set(sessionId, { userId: account.id, activeRefreshToken: null });
    createRefreshToken(sessionId);
    return send(res, 200, sessionResponse(sessionId));
  };

  const refreshGrant = async (res, { refresh_token: token }) => {
    if (refreshBarrier) {
      const barrier = refreshBarrier;
      barrier.arrived += 1;

      if (barrier.arrived >= barrier.count) {
        refreshBarrier = null;
        barrier.release();
      }

      await barrier.released;
    }

    const stored = refreshTokens.get(token);
    if (!stored || !sessions.has(stored.sessionId)) {
      return sendError(res, 400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
    }

    const session = sessions.get(stored.sessionId);

    if (stored.replacedBy) {
      // Token já trocado. Se ele é o "pai" do token ativo (o cliente não recebeu a resposta
      // anterior), devolve o ativo. Qualquer outro reuso é suspeito: encerra a sessão inteira.
      if (stored.replacedBy !== session.activeRefreshToken) {
        endSession(stored.sessionId);
        return sendError(res, 400, 'refresh_token_already_used', 'Invalid Refresh Token: Already Used');
      }

      return send(res, 200, sessionResponse(stored.sessionId));
    }

    stored.replacedBy = createRefreshToken(stored.sessionId);
    return send(res, 200, sessionResponse(stored.sessionId));
  };

  const getUser = (req, res) => {
    const auth = authenticate(req);
    if (auth.error) {
      return sendError(res, ...auth.error);
    }

    return send(res, 200, toUserJson(accountById(sessions.get(auth.sessionId).userId)));
  };

  const logout = (req, res, scope) => {
    const auth = authenticate(req);
    if (auth.error) {
      return sendError(res, ...auth.error);
    }

    if (scope === 'local') {
      endSession(auth.sessionId);
    } else {
      const { userId } = sessions.get(auth.sessionId);
      for (const [sessionId, session] of sessions) {
        if (session.userId === userId) {
          endSession(sessionId);
        }
      }
    }

    res.writeHead(204);
    return res.end();
  };

  const readJson = async (req) => {
    let text = '';
    for await (const chunk of req) {
      text += chunk;
    }

    return text ? JSON.parse(text) : {};
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://auth-simulado');
    const grantType = url.searchParams.get('grant_type');
    const endpoint = `${req.method} ${url.pathname}${grantType ? `?grant_type=${grantType}` : ''}`;
    const body = req.method === 'POST' ? await readJson(req) : {};

    requests.push({
      endpoint,
      scope: url.searchParams.get('scope'),
      apikey: req.headers.apikey,
      // Só registra SE havia um Bearer de um token emitido aqui (nunca o valor).
      bearer: accessTokens.has((req.headers.authorization ?? '').replace('Bearer ', ''))
    });

    if (failures.length > 0) {
      return sendError(res, failures.shift(), 'unexpected_failure', 'Simulated outage');
    }

    switch (endpoint) {
      case 'POST /auth/v1/token?grant_type=password':
        return passwordGrant(res, body);
      case 'POST /auth/v1/token?grant_type=refresh_token':
        return refreshGrant(res, body);
      case 'GET /auth/v1/user':
        return getUser(req, res);
      case 'POST /auth/v1/logout':
        return logout(req, res, url.searchParams.get('scope') || 'global');
      default:
        return sendError(res, 404, 'not_found', 'Not found');
    }
  });

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    issuedTokens,

    // Conta que o "Supabase" conhece. O id deve ser o mesmo de auth.users no banco em memória.
    addAccount: ({ id, email, password, confirmed = true }) => {
      accounts.set(email, { id, email, password, confirmed });
    },

    // Faz todos os access tokens já emitidos vencerem, como se 1 hora tivesse passado.
    expireAccessTokens: () => {
      for (const stored of accessTokens.values()) {
        stored.expiresAt = Date.now() - 1000;
      }
    },

    // As próximas "times" chamadas respondem com este status (ex.: 503, Supabase fora do ar).
    failNext: (status, times = 1) => {
      for (let index = 0; index < times; index += 1) {
        failures.push(status);
      }
    },

    // As renovações só são respondidas quando "count" delas tiverem chegado ao mesmo tempo.
    // Devolve uma promessa: true se chegaram todas; false se o prazo acabou antes. Nesse caso
    // as que chegaram são liberadas, para o teste falhar com uma mensagem em vez de travar.
    holdRefreshesUntil: (count, timeoutMs = 3000) => {
      let release;
      const released = new Promise((resolve) => {
        release = resolve;
      });
      const barrier = { count, arrived: 0, release, released };
      refreshBarrier = barrier;

      const timer = setTimeout(() => {
        if (refreshBarrier === barrier) {
          refreshBarrier = null;
          barrier.release(false);
        }
      }, timeoutMs);

      return released.then((reached = true) => {
        clearTimeout(timer);
        return reached;
      });
    },

    countRequests: (endpoint) => requests.filter((request) => request.endpoint === endpoint).length,

    activeSessionsOf: (userId) => [...sessions.values()].filter((session) => session.userId === userId).length,

    close: () => new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(resolve);
    })
  };
};
