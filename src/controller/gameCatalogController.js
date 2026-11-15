import { getGameCatalog } from '../service/gameCatalogService.js';

export const getGameCatalogController = async (req, res, next) => {
  try {
    // Nos testes, app.locals.gameCatalogContext troca o banco por um em memória.
    const catalog = await getGameCatalog(req.app.locals.gameCatalogContext?.db);

    res.json(catalog);
  } catch (error) {
    next(error);
  }
};
