import { listRanking, rankingQuerySchema } from '../service/rankingService.js';

export const listRankingController = async (req, res) => {
  const validation = rankingQuerySchema.safeParse(req.query);

  if (!validation.success) {
    res.status(400).json({
      error: 'Parâmetros de consulta inválidos.',
      details: validation.error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message
      }))
    });
    return;
  }

  const { limit, offset } = validation.data;

  try {
    const ranking = await listRanking({ limit, offset });
    res.json({ ranking, limit, offset });
  } catch (error) {
    console.error('[ranking] Falha ao consultar ranking:', error.message);
    res.status(503).json({ error: 'Não foi possível consultar o ranking no momento.' });
  }
};
