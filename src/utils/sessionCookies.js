import { parse } from 'cookie';

import config from '../config/index.js';

// Cookies da sessão. Os dois são httpOnly: o JavaScript da página não consegue lê-los, então
// o front-end nunca vê os tokens. O navegador os envia sozinho para as rotas /api quando a
// requisição usa credentials: 'include'. Os atributos ficam em config.sessionCookie.
export const ACCESS_TOKEN_COOKIE = 'tbott_access_token';
export const REFRESH_TOKEN_COOKIE = 'tbott_refresh_token';

// O Supabase não dá prazo ao refresh token: ele vale até ser trocado ou a sessão acabar.
// Este é o tempo que o NAVEGADOR guarda o cookie: depois de 30 dias sem abrir o jogo, o
// jogador precisa entrar de novo. A cada renovação da sessão, o prazo recomeça.
export const REFRESH_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

// O Express escreve cookies (res.cookie), mas não lê: o pacote cookie (o mesmo que o Express
// usa) transforma o cabeçalho "Cookie: a=1; b=2" em { a: '1', b: '2' }.
export const readSessionCookies = (req) => {
  const cookies = parse(req.headers.cookie ?? '');

  return {
    accessToken: cookies[ACCESS_TOKEN_COOKIE] || null,
    refreshToken: cookies[REFRESH_TOKEN_COOKIE] || null
  };
};

// Respostas com dados do jogador ou com Set-Cookie de sessão não podem ficar em cache:
// uma CDN ou proxy poderia entregar a sessão de um jogador a outro.
export const preventCaching = (res) => {
  res.set('Cache-Control', 'private, no-store');
};

// O access token vive no cookie exatamente o tempo que o Supabase informou (expires_in, em
// segundos). Quando o cookie some, a próxima requisição renova a sessão com o refresh token.
export const setSessionCookies = (res, session, options = config.sessionCookie) => {
  preventCaching(res);
  res.cookie(ACCESS_TOKEN_COOKIE, session.access_token, { ...options, maxAge: session.expires_in * 1000 });
  res.cookie(REFRESH_TOKEN_COOKIE, session.refresh_token, { ...options, maxAge: REFRESH_COOKIE_MAX_AGE_MS });
};

// Para o navegador apagar um cookie, o nome e o path precisam ser os mesmos de quando ele foi
// gravado. O res.clearCookie reenvia o cookie vazio, com validade no passado.
export const clearSessionCookies = (res, options = config.sessionCookie) => {
  preventCaching(res);
  res.clearCookie(ACCESS_TOKEN_COOKIE, options);
  res.clearCookie(REFRESH_TOKEN_COOKIE, options);
};
