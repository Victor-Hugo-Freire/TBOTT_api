import { registerUser, registerUserSchema } from '../service/authService.js';
import { AppError } from '../utils/httpError.js';

export const registerUserController = async (req, res, next) => {
  const validation = registerUserSchema.safeParse(req.body);

  if (!validation.success) {
    next(new AppError({
      statusCode: 400,
      code: 'INVALID_REGISTER_DATA',
      message: 'Dados de cadastro inválidos.',
      details: validation.error.issues.map((issue) => ({
        field: issue.path.join('.') || 'request',
        message: issue.message
      }))
    }));
    return;
  }

  try {
    const result = await registerUser(validation.data);

    res.status(201).json({
      ok: true,
      data: result
    });
  } catch (error) {
    next(error);
  }
};
