import { registerRoute } from '../docs/catalog.js';
import { registerUserController } from '../controller/authController.js';

export const registerAuthRoutes = (app) => {
  registerRoute({
    app,
    method: 'POST',
    path: '/api/auth/register',
    category: 'Autenticação',
    description: 'Cria uma nova conta de jogador no Supabase Auth e mantém o perfil associado ao usuário.',
    auth: 'Pública',
    requestBody: {
      required: true,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            required: ['username', 'email', 'password'],
            properties: {
              username: {
                type: 'string',
                minLength: 3,
                maxLength: 20,
                pattern: '^[A-Za-z0-9_]+$',
                description: 'Nome de usuário único, com 3 a 20 caracteres. Letras, números e underscore (_) são permitidos.'
              },
              email: {
                type: 'string',
                format: 'email',
                description: 'E-mail válido e acessível do jogador. Este valor será usado para confirmação e recuperação da conta no Supabase Auth.'
              },
              password: {
                type: 'string',
                minLength: 8,
                maxLength: 72,
                description: 'Senha mínima de 8 caracteres. O valor nunca é exposto em respostas.'
              }
            }
          },
          example: {
            username: 'jogador123',
            email: 'usuario@provedor.com',
            password: 'senha-de-exemplo'
          }
        }
      }
    },
    responses: {
      201: { description: 'Cadastro realizado com sucesso. Se o e-mail ainda não estiver confirmado, a conta fica pendente.' },
      400: { description: 'Dados de entrada inválidos ou ausentes.' },
      409: { description: 'Nome de usuário ou e-mail já cadastrado.' },
      429: { description: 'Limite de requisições excedido.' },
      503: { description: 'Supabase Auth indisponível ou configuração ausente.' }
    },
    handler: registerUserController
  });
};
