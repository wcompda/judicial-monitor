// Classificação de erros: é ela que decide se a fila re-tenta ou desiste.
//
//  TransientError  → portal fora do ar, timeout, 5xx, 429, CAPTCHA errado. Re-tenta com backoff.
//  PermanentError  → CNPJ inválido, credencial recusada, ente sem adapter. Não adianta re-tentar.
//
// Qualquer erro não classificado é tratado como transitório (fail-safe para portais instáveis).

class CertidaoError extends Error {
  constructor(message, { code, cause, details } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    if (cause) this.cause = cause;
  }
}

class TransientError extends CertidaoError {
  constructor(message, opts = {}) {
    super(message, opts);
    // Permite que o portal sugira quando voltar (ex: header Retry-After)
    this.retryAfterMs = opts.retryAfterMs;
  }
}

class PermanentError extends CertidaoError {}

class CaptchaError extends TransientError {}

// Converte erro de axios em Transient/Permanent pelo status HTTP
function fromHttpError(err, contexto) {
  if (err instanceof CertidaoError) return err;
  const status = err.response?.status;
  const msg = `${contexto}: ${status ? `HTTP ${status}` : err.code || err.message}`;
  if (!status) return new TransientError(msg, { cause: err, code: err.code });
  if (status === 429 || status >= 500 || status === 408) {
    const ra = parseInt(err.response.headers?.['retry-after'], 10);
    return new TransientError(msg, { cause: err, code: status, retryAfterMs: Number.isFinite(ra) ? ra * 1000 : undefined });
  }
  return new PermanentError(msg, { cause: err, code: status, details: safeBody(err.response.data) });
}

function safeBody(data) {
  if (!data) return undefined;
  if (Buffer.isBuffer(data)) return data.toString('utf8').slice(0, 500);
  return typeof data === 'string' ? data.slice(0, 500) : data;
}

module.exports = { CertidaoError, TransientError, PermanentError, CaptchaError, fromHttpError };
