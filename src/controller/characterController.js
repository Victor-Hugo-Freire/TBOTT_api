import { listCharacters } from '../service/characterService.js';

export const listCharactersController = async (_req, res) => {
  try {
    const characters = await listCharacters();
    res.json({ characters });
  } catch (error) {
    console.error('[characters] Falha ao consultar personagens:', error.message);
    res.status(503).json({ error: 'Não foi possível consultar os personagens no momento.' });
  }
};
