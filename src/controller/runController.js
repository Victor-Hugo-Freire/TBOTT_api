import { createRun, createRunSchema } from '../service/runService.js';
import { AppError, normalizeValidationDetails } from '../utils/httpError.js';

export const createRunController = async (req, res, next) => {
  const validation = createRunSchema.safeParse(req.body);

  if (!validation.success) {
    next(new AppError({
      statusCode: 400,
      code: 'INVALID_RUN_DATA',
      message: 'Dados da partida inválidos.',
      details: normalizeValidationDetails(validation.error.issues)
    }));
    return;
  }

  try {
    // req.user vem do requireAuth (cookie da sessão): o corpo nunca decide quem é o jogador.
    // Nos testes, app.locals.runContext troca o banco por um em memória.
    const run = await createRun(req.user.id, validation.data, req.app.locals.runContext);

    res.status(201).json({ run });
  } catch (error) {
    next(error);
  }
};
