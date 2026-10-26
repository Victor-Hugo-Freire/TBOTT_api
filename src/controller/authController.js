import {
  getCurrentUser,
  loginSchema,
  loginUser,
  logoutUser,
  registerUser,
  registerUserSchema
} from '../service/authService.js';
import { AppError, normalizeValidationDetails } from '../utils/httpError.js';
import { clearSessionCookies, readSessionCookies, setSessionCookies } from '../utils/sessionCookies.js';

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

export const loginController = async (req, res, next) => {
  const validation = loginSchema.safeParse(req.body);

  if (!validation.success) {
    next(new AppError({
      statusCode: 400,
      code: 'INVALID_LOGIN_DATA',
      message: 'Dados de login inválidos.',
      details: normalizeValidationDetails(validation.error.issues)
    }));
    return;
  }

  try {
    const { session, ...body } = await loginUser(validation.data, req.app.locals.authContext);

    // Os tokens vão só para os cookies httpOnly. O corpo leva apenas user e profile.
    setSessionCookies(res, session);
    res.json(body);
  } catch (error) {
    next(error);
  }
};

export const getCurrentUserController = async (req, res, next) => {
  try {
    // req.user foi preenchido pelo middleware requireAuth.
    res.json(await getCurrentUser(req.user, req.app.locals.authContext));
  } catch (error) {
    next(error);
  }
};

export const logoutController = async (req, res, next) => {
  // Os cookies são apagados mesmo se o Supabase não puder ser avisado: assim o navegador deixa
  // de ter a sessão de qualquer jeito. Os tokens do pedido continuam em req para o service.
  clearSessionCookies(res);

  try {
    await logoutUser(readSessionCookies(req), req.app.locals.authContext);
    res.json({ status: 'logged_out' });
  } catch (error) {
    next(error);
  }
};
