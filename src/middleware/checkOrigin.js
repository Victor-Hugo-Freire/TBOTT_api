import config from '../config/index.js';
import { AppError } from '../utils/httpError.js';

// Métodos que só leem dados: não precisam da verificação.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// A requisição veio de uma página da própria API (ex.: o Swagger em http://localhost:8000/api-docs).
const isSameOrigin = (origin, req) => {
  try {
    return new URL(origin).host === req.get('host');
  } catch {
    // Ex.: "Origin: null", enviado por páginas em sandbox e por arquivos abertos no navegador.
    return false;
  }
};

// Proteção contra CSRF. O navegador envia os cookies de sessão sozinho, mesmo quando é outro
// site que dispara a requisição (por exemplo, um formulário escondido que faz logout do jogador).
// Nas requisições que alteram dados, o navegador também envia o cabeçalho Origin, que a página
// não consegue falsificar. Por isso a API aceita apenas:
// - o TBOTT_web (FRONTEND_ORIGINS);
// - páginas da própria API (Swagger);
// - requisições sem Origin, que não vêm de um navegador (curl, PowerShell, Postman).
// O CORS sozinho não basta: ele só impede o outro site de LER a resposta, e alguns envios
// (como formulários HTML) chegam à API sem o navegador pedir permissão antes.
export const createOriginCheck = (allowedOrigins) => (req, _res, next) => {
  const origin = req.get('origin');

  if (SAFE_METHODS.has(req.method) || !origin || allowedOrigins.includes(origin) || isSameOrigin(origin, req)) {
    next();
    return;
  }

  console.warn(`[csrf] stage=origin_rejected method=${req.method} origin=${JSON.stringify(origin)}`);
  next(new AppError({
    statusCode: 403,
    code: 'ORIGIN_NOT_ALLOWED',
    message: 'Origem não autorizada para esta operação.'
  }));
};

export const checkOrigin = createOriginCheck(config.frontendOrigins);
