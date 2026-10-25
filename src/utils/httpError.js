export class AppError extends Error {
  constructor({
    statusCode = 500,
    code = 'INTERNAL_ERROR',
    message = 'Erro interno do servidor.',
    details = null
  } = {}) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const normalizeValidationDetails = (issues = []) => issues.map((issue) => ({
  field: issue.path.join('.') || 'request',
  message: issue.message
}));
