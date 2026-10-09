const IORedis = require('ioredis');
const { Queue, FlowProducer } = require('bullmq');
const config = require('../config');
const { computeBackoff } = require('../core/backoff');

// Filas (uma por "contrato de rate limit", não por tipo de certidão):
//   federal → chamadas ao Serpro
//   broker  → chamadas ao Infosimples (FGTS, trabalhista, estadual, municipal, simples)
//   lote    → job-pai por CNPJ: roda quando TODOS os filhos terminam e aplica o Raio X
//   raio-x  → varredura da carteira, disparada sob demanda pela API
const FILAS = Object.freeze({ federal: 'federal', broker: 'broker', lote: 'lote', raioX: 'raio-x' });

let connection;
function getConnection() {
  // maxRetriesPerRequest: null é obrigatório para Workers do BullMQ
  if (!connection) connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  return connection;
}

const queues = {};
function getQueue(nome) {
  if (!queues[nome]) queues[nome] = new Queue(nome, { connection: getConnection(), prefix: config.queuePrefix });
  return queues[nome];
}

let flowProducer;
function getFlowProducer() {
  if (!flowProducer) flowProducer = new FlowProducer({ connection: getConnection(), prefix: config.queuePrefix });
  return flowProducer;
}

// Retry agressivo com exponential backoff + jitter. Respeita Retry-After quando o portal manda.
function backoffStrategy(attemptsMade, _type, err) {
  if (err?.retryAfterMs) return Math.min(err.retryAfterMs, config.retry.maxDelayMs);
  return computeBackoff(attemptsMade, config.retry);
}

const opcoesFilho = () => ({
  attempts: config.retry.attempts,
  backoff: { type: 'jitter' }, // tipo custom → usa backoffStrategy do Worker
  // Um filho que falha de vez NÃO trava o pai: o lote do CNPJ fecha com o que deu certo
  ignoreDependencyOnFailure: true,
  removeOnComplete: { age: 7 * 86400, count: 10000 },
  removeOnFail: { age: 30 * 86400 },
});

async function fecharFilas() {
  await Promise.allSettled([...Object.values(queues).map((q) => q.close()), flowProducer?.close()]);
  await connection?.quit().catch(() => {});
}

module.exports = { FILAS, getConnection, getQueue, getFlowProducer, backoffStrategy, opcoesFilho, fecharFilas };
