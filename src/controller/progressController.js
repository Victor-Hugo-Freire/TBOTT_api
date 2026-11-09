import { AppError, normalizeValidationDetails } from '../utils/httpError.js';
import { getProgress, hasProgress, saveProgress, createProgressSchema } from '../service/progressService.js';

export const saveProgressController = async (req, res, next) => {
  const validation = createProgressSchema.safeParse(req.body);

  if (!validation.success) {
    next(new AppError({
      statusCode: 400,
      code: 'INVALID_PROGRESS_DATA',
      message: 'Dados de progresso inválidos.',
      details: normalizeValidationDetails(validation.error.issues)
    }));
    return;
  }

  try {
    const result = await saveProgress(req.user.id, validation.data, {
      db: req.app.locals.progressContext?.db,
      repo: req.app.locals.progressContext?.repo
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const getProgressController = async (req, res, next) => {
  try {
    const result = await getProgress(req.user.id, req.app.locals.progressContext?.db);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const hasProgressController = async (req, res, next) => {
  try {
    const result = await hasProgress(req.user.id, req.app.locals.progressContext?.db);
    res.json({ exists: result });
  } catch (error) {
    next(error);
  }
};
