import { randomUUID } from 'node:crypto';

// Simula supabase.auth.signUp sobre o banco em memória, respondendo como o Supabase Auth
// (documentação do signUp e código do servidor do Supabase Auth):
// - e-mail novo: grava em auth.users (o gatilho real cria o perfil) e devolve o usuário com
//   uma identidade. Só há sessão (tokens) quando a confirmação de e-mail está desligada;
// - e-mail repetido com a confirmação desligada: erro user_already_exists;
// - e-mail repetido e já confirmado, com a confirmação ligada: usuário FALSO, com id
//   aleatório e identities vazio, sem erro (o Supabase esconde que a conta existe);
// - e-mail repetido ainda não confirmado: devolve o usuário real, sem alterar seus dados
//   (o Supabase só reenvia o e-mail de confirmação).
export const createFakeSupabaseAuth = (db, { confirmEmail = true, beforeSignUp } = {}) => {
  const confirmedEmails = new Set();
  const signUpCalls = [];
  let queue = Promise.resolve();

  const signUpNow = async ({ email, options }) => {
    const existing = await db.query('select id from auth.users where email = $1', [email]);
    const existingId = existing.rows[0]?.id;

    if (existingId && !confirmEmail) {
      return {
        data: { user: null, session: null },
        error: { code: 'user_already_exists', status: 422, message: 'User already registered' }
      };
    }

    if (existingId && confirmedEmails.has(email)) {
      return { data: { user: { id: randomUUID(), email, identities: [] }, session: null }, error: null };
    }

    let id = existingId;
    if (!id) {
      // Grava como o dono do banco, sem trocar de papel (set role), para não interferir nas
      // consultas de outra requisição simultânea. O gatilho dispara do mesmo jeito.
      const created = await db.query(
        'insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id',
        [email, JSON.stringify(options?.data ?? {})]
      );
      id = created.rows[0].id;
    }

    return {
      data: {
        user: { id, email, identities: [{ provider: 'email' }] },
        session: confirmEmail ? null : { access_token: 'token-falso', refresh_token: 'refresh-falso' }
      },
      error: null
    };
  };

  return {
    signUpCalls,
    // Marca o e-mail como confirmado, como se o jogador tivesse clicado no link.
    confirm: (email) => confirmedEmails.add(email),
    auth: {
      signUp: async (credentials) => {
        signUpCalls.push({ email: credentials.email, username: credentials.options?.data?.username });

        if (beforeSignUp) {
          await beforeSignUp();
        }

        // Uma conta por vez, como as transações do Supabase Auth.
        const result = queue.then(() => signUpNow(credentials));
        queue = result.catch(() => {});
        return result;
      }
    }
  };
};
