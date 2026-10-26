import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

import { AppError } from '../utils/httpError.js';

export const getSupabaseAuthConfig = () => {
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new AppError({
      statusCode: 503,
      code: 'SUPABASE_CONFIG_MISSING',
      message: 'Configuração do Supabase não encontrada. Defina SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY.'
    });
  }

  return {
    supabaseUrl,
    supabaseKey
  };
};

// Cria um cliente NOVO a cada chamada: cada requisição usa o seu e o descarta no fim.
// O cliente do Supabase guarda dentro dele a sessão do último login, cadastro ou renovação,
// e junta renovações simultâneas numa só sem olhar de quem é o token. Um cliente único para
// a API inteira poderia entregar a sessão de um jogador a outro.
export const createSupabaseClient = () => {
  const { supabaseUrl, supabaseKey } = getSupabaseAuthConfig();

  try {
    return createClient(supabaseUrl, supabaseKey, {
      auth: {
        // A sessão fica nos cookies do navegador, nunca guardada no servidor.
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      },
      realtime: {
        transport: WebSocket
      }
    });
  } catch (error) {
    console.error('[auth] stage=supabase_client_init_error', {
      message: error instanceof Error ? error.message : String(error)
    });

    throw new AppError({
      statusCode: 503,
      code: 'SUPABASE_CLIENT_INIT_FAILED',
      message: 'Não foi possível inicializar o cliente do Supabase.'
    });
  }
};
