// Endereços falsos para os testes do cadastro. O dotenv não sobrescreve variáveis que já
// existem, então o .env real é ignorado e nenhum teste alcança o banco ou o Supabase de verdade.
// A porta 1 recusa a conexão na hora: o teste falha rápido em vez de esperar.
// Importe este arquivo ANTES de qualquer módulo de src/.
process.env.DATABASE_URL = 'postgresql://teste:teste@127.0.0.1:1/teste';
process.env.DATABASE_SSL_CA_PATH = '';
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_teste';
process.env.SUPABASE_ANON_KEY = '';
