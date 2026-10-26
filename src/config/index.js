import 'dotenv/config';

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';

// Endereço do TBOTT_web em desenvolvimento (servidor do Vite).
export const DEFAULT_FRONTEND_ORIGIN = 'http://localhost:5173';

// FRONTEND_ORIGINS: endereços do TBOTT_web, separados por vírgula.
// Cada um vira uma "origem" (protocolo + domínio + porta, sem barra no final), o formato do
// cabeçalho Origin que o navegador envia. Sempre devolve uma lista: a biblioteca cors trata
// um valor vazio como "qualquer origem", o que nunca pode acontecer com cookies de sessão.
export const parseFrontendOrigins = (value = '', { production = false } = {}) => {
    const entries = value.split(',').map((entry) => entry.trim()).filter(Boolean);

    if (entries.length === 0) {
        // Em produção não há padrão: o endereço publicado do front-end precisa ser configurado.
        return production ? [] : [DEFAULT_FRONTEND_ORIGIN];
    }

    return entries.map((entry) => {
        if (entry === '*') {
            throw new Error('FRONTEND_ORIGINS não aceita "*": com cookies, cada origem precisa ser listada.');
        }

        let url;
        try {
            url = new URL(entry);
        } catch {
            url = null;
        }

        if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
            throw new Error(`FRONTEND_ORIGINS tem um endereço inválido: "${entry}". Exemplo válido: http://localhost:5173`);
        }

        return url.origin;
    });
};

const SAME_SITE_VALUES = ['lax', 'strict', 'none'];

// Atributos comuns aos dois cookies de sessão (veja src/utils/sessionCookies.js):
// - httpOnly: o JavaScript da página não consegue ler os cookies (protege os tokens contra XSS);
// - secure: só trafegam por HTTPS. Ligado em produção. Em desenvolvimento a API roda em
//   http://localhost, e alguns navegadores recusam cookies Secure sem HTTPS;
// - sameSite: "lax" por padrão. "none" só é necessário se o front-end e a API ficarem em
//   sites diferentes, e o navegador exige Secure junto;
// - path: /api, para os cookies irem só para as rotas da API.
export const buildSessionCookieOptions = ({ production = false, sameSite = '' } = {}) => {
    const sameSiteValue = sameSite.trim().toLowerCase() || 'lax';

    if (!SAME_SITE_VALUES.includes(sameSiteValue)) {
        throw new Error(`SESSION_COOKIE_SAMESITE inválido: "${sameSite}". Use lax, strict ou none.`);
    }

    if (sameSiteValue === 'none' && !production) {
        throw new Error('SESSION_COOKIE_SAMESITE=none exige cookies Secure (HTTPS): use só com NODE_ENV=production.');
    }

    return {
        httpOnly: true,
        secure: production,
        sameSite: sameSiteValue,
        path: '/api'
    };
};

const config = {
    port: Number(process.env.PORT) || 8000,
    nodeEnv,
    databaseUrl: process.env.DATABASE_URL || 'postgresql://postgres:your-password@localhost:5432/postgres',
    databaseSslCaPath: process.env.DATABASE_SSL_CA_PATH || '',
    frontendOrigins: parseFrontendOrigins(process.env.FRONTEND_ORIGINS, { production: isProduction }),
    sessionCookie: buildSessionCookieOptions({ production: isProduction, sameSite: process.env.SESSION_COOKIE_SAMESITE })
};

export default config;
