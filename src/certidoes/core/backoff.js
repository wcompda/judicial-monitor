const { PermanentError } = require('./errors');

// Exponential backoff com "full jitter" (AWS Architecture Blog).
// O jitter evita que dezenas de jobs re-tentem no mesmo segundo e derrubem de novo o portal.
//   delay = random(0, min(max, base * 2^(tentativa-1)))   — com piso de base/2
function computeBackoff(attempt, { baseDelayMs, maxDelayMs }, random = Math.random) {
  const exp = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(0, attempt - 1));
  const floor = Math.min(exp, baseDelayMs / 2);
  return Math.round(floor + random() * (exp - floor));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry curto, dentro do mesmo job (ex: renovar token, 1 soluço de rede).
// O retry "longo" (minutos) é responsabilidade da fila — ver queue/backoffStrategy.js.
async function withRetry(fn, { retries = 3, baseDelayMs = 500, maxDelayMs = 5000, onRetry } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries + 1; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (err instanceof PermanentError || attempt > retries) throw err;
      const delay = err.retryAfterMs ?? computeBackoff(attempt, { baseDelayMs, maxDelayMs });
      onRetry?.(err, attempt, delay);
      await sleep(delay);
    }
  }
  throw lastErr;
}

module.exports = { computeBackoff, withRetry, sleep };
