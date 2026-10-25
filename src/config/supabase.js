import 'dotenv/config';

import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

import { AppError } from '../utils/httpError.js';

let supabaseClient = null;

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

export const getSupabaseClient = () => {
  if (supabaseClient) {
    return supabaseClient;
  }

  const { supabaseUrl, supabaseKey } = getSupabaseAuthConfig();

  try {
    console.info('[auth:register] stage=supabase_client_init');

    supabaseClient = createClient(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false
      },
      realtime: {
        transport: WebSocket
      }
    });
  } catch (error) {
    console.error('[auth:register] stage=supabase_client_init_error', {
      message: error instanceof Error ? error.message : String(error)
    });

    throw new AppError({
      statusCode: 503,
      code: 'SUPABASE_CLIENT_INIT_FAILED',
      message: 'Não foi possível inicializar o cliente do Supabase.'
    });
  }

  return supabaseClient;
};
