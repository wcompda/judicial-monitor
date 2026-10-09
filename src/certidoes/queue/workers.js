const { Worker, UnrecoverableError } = require('bullmq');
const config = require('../config');
const repo = require('../database/repository');
const { emitirCertidao, registrarFalha } = require('../emissaoService');
const { PermanentError } = require('../core/errors');
const { FILAS, getConnection, backoffStrategy } = require('./queues');
const { varredura, consolidarCnpj } = require('../raioX/raioXService');

// Processador dos jobs-filho (uma certidão).
// Erro permanente → UnrecoverableError (BullMQ não re-tenta). Transitório → re-tenta com backoff.
// Na ÚLTIMA falha grava a linha ERRO no log, para o Raio X e o front enxergarem.
async function processarCertidao(job) {
  const { loteId, cnpj, tipo } = job.data;
  const tentativa = job.attemptsMade + 1;
  const empresa = await repo.buscarEmpresa(cnpj);
  try {
    if (!empresa) throw new PermanentError(`CNPJ ${cnpj} não cadastrado em cert_empresas`);
    return await emitirCertidao({ tipo, empresa, loteId, tentativas: tentativa });
  } catch (err) {
    const permanente = err instanceof PermanentError;
    const ultima = permanente || tentativa >= (job.opts.attempts || 1);
    console.warn(`[certidoes] ${tipo} ${cnpj} tentativa ${tentativa}: ${err.message}${ultima ? ' (desistindo)' : ''}`);
    if (ultima) await registrarFalha({ tipo, empresa: empresa || { cnpj }, loteId, tentativas: tentativa, erro: err });
    if (permanente) throw new UnrecoverableError(err.message);
    throw err;
  }
}

function iniciarWorkers() {
  const connection = getConnection();
  const base = { connection, prefix: config.queuePrefix, settings: { backoffStrategy } };

  const workers = [
    new Worker(FILAS.federal, processarCertidao, { ...base, concurrency: config.concurrency.federal }),
    new Worker(FILAS.broker, processarCertidao, { ...base, concurrency: config.concurrency.broker }),
    new Worker(FILAS.lote, (job) => consolidarCnpj(job.data), { ...base, concurrency: config.concurrency.lote }),
    new Worker(FILAS.raioX, () => varredura(), { ...base, concurrency: 1 }),
  ];

  for (const w of workers) {
    w.on('failed', (job, err) => {
      if (job && (err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts || 1))) {
        console.error(`[certidoes] ${w.name}/${job.name} ${job.id} falhou definitivamente: ${err.message}`);
      }
    });
    w.on('error', (err) => console.error(`[certidoes] worker ${w.name}:`, err.message));
  }
  return workers;
}

module.exports = { iniciarWorkers, processarCertidao };
