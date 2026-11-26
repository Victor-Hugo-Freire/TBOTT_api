import { createUnlock, createUnlockSchema, listUnlocks } from '../service/unlockService.js';
import { AppError, normalizeValidationDetails } from '../utils/httpError.js';

export const listUnlocksController = async (req, res, next) => {
  try {
    // req.user vem do requireAuth (cookie da sessão). Nos testes, app.locals.unlockContext troca o banco por um em memória.
    const unlocks = await listUnlocks(req.user.id, req.app.locals.unlockContext?.db);

    res.json({ unlocks });
  } catch (error) {
    next(error);
  }
};

export const createUnlockController = async (req, res, next) => {
  const validation = createUnlockSchema.safeParse(req.body);

  if (!validation.success) {
    next(new AppError({
      statusCode: 400,
      code: 'INVALID_UNLOCK_DATA',
      message: 'Dados do desbloqueio inválidos.',
      details: normalizeValidationDetails(validation.error.issues)
    }));
    return;
  }

  try {
    const { unlock, created } = await createUnlock(req.user.id, validation.data, req.app.locals.unlockContext?.db);

    // 201 = liberou agora; 200 = já estava liberado (não duplica).
    res.status(created ? 201 : 200).json({ unlock, created });
  } catch (error) {
    next(error);
  }
};
