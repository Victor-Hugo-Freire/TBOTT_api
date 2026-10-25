import { registerUser, registerUserSchema } from '../service/authService.js';
import { AppError, normalizeValidationDetails } from '../utils/httpError.js';

export const registerUserController = async (req, res, next) => {
  const validation = registerUserSchema.safeParse(req.body);

  if (!validation.success) {
    next(new AppError({
      statusCode: 400,
      code: 'INVALID_REGISTER_DATA',
      message: 'Dados de cadastro inválidos.',
      details: normalizeValidationDetails(validation.error.issues)
    }));
    return;
  }

  try {
    // Nos testes, app.locals.authContext troca o Supabase e o banco por versões em memória.
    // Na API de verdade ele não existe, e o service usa o Supabase e o PostgreSQL reais.
    const result = await registerUser(validation.data, req.app.locals.authContext);

    // Sem envelope, como nas outras rotas ({ characters }, { ranking, ... }).
    res.status(201).json(result);
  } catch (error) {
    next(error);
  }
};
