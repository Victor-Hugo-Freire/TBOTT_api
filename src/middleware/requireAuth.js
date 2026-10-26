import { resolveSession } from '../service/authService.js';
import { AppError } from '../utils/httpError.js';
import { clearSessionCookies, preventCaching, readSessionCookies, setSessionCookies } from '../utils/sessionCookies.js';

// Middleware das rotas que exigem login. Uso no registro da rota:
//   registerRoute({ ..., middlewares: [requireAuth], handler: meuController })
// No controller, req.user = { id, email } é o jogador logado (o id é o mesmo de profiles.id).
export const requireAuth = async (req, res, next) => {
  // As respostas trazem dados do jogador: nunca podem ficar em cache.
  preventCaching(res);

  const tokens = readSessionCookies(req);

  if (!tokens.accessToken && !tokens.refreshToken) {
    next(new AppError({
      statusCode: 401,
      code: 'AUTH_SESSION_MISSING',
      message: 'Faça login para continuar.'
    }));
    return;
  }

  try {
    // Nos testes, app.locals.authContext troca o Supabase e o banco por versões simuladas.
    const { user, renewedSession } = await resolveSession(tokens, req.app.locals.authContext);

    // O access token tinha vencido e o refresh token foi trocado: os tokens novos vão já nesta
    // resposta, porque o refresh token antigo não vale mais.
    if (renewedSession) {
      setSessionCookies(res, renewedSession);
    }

    req.user = user;
    next();
  } catch (error) {
    // O Supabase recusou a sessão (token inválido, vencido ou encerrado): apaga os cookies para
    // o navegador não continuar enviando credenciais mortas. Se o Supabase está fora do ar, os
    // cookies ficam, porque a sessão pode continuar válida.
    if (error instanceof AppError && error.code === 'AUTH_SESSION_EXPIRED') {
      clearSessionCookies(res);
    }

    next(error);
  }
};
