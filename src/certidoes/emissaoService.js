const config = require('./config');
const repo = require('./database/repository');
const { ObjectStorage } = require('./storage/objectStorage');
const { getAdapter } = require('./adapters/registry');

let storage;
const getStorage = () => storage || (storage = new ObjectStorage(config.storage));

// Uma certidão, ponta a ponta: adapter → PDF (Buffer) → S3 → log no Postgres.
// Devolve apenas metadados — o Buffer morre aqui, nunca vai para o Redis.
async function emitirCertidao({ tipo, empresa, loteId, tentativas = 1 }, deps = {}) {
  const adapter = deps.adapter || getAdapter(tipo);
  const s3 = deps.storage || getStorage();
  const repository = deps.repo || repo;

  const r = await adapter.emitir({
    cnpj: empresa.cnpj,
    uf: empresa.uf,
    municipioIbge: empresa.municipio_ibge,
    certificadoId: empresa.certificado_id,
  });

  const arquivo = r.pdf
    ? await s3.salvarPdf({ cnpj: empresa.cnpj, tipo, pdf: r.pdf, metadados: { numero: r.numero, fonte: r.fonte } })
    : null;

  const row = await repository.registrarCertidao({
    loteId,
    cnpj: empresa.cnpj,
    tipo,
    status: 'EMITIDA',
    situacao: r.situacao,
    numero: r.numero,
    pdfBucket: arquivo?.bucket,
    pdfKey: arquivo?.key,
    pdfSha256: arquivo?.sha256,
    pdfUrlOrigem: r.pdfUrlOrigem,
    emitidaEm: r.emitidaEm,
    validaAte: r.validaAte,
    fonte: r.fonte,
    tentativas,
    raw: { ...r.raw, extras: r.extras },
  });

  return { certidaoId: row.id, tipo, situacao: r.situacao, validaAte: r.validaAte, pdfKey: arquivo?.key || null };
}

async function registrarFalha({ tipo, empresa, loteId, tentativas, erro }, deps = {}) {
  const repository = deps.repo || repo;
  return repository.registrarCertidao({
    loteId,
    cnpj: empresa.cnpj,
    tipo,
    status: 'ERRO',
    tentativas,
    erro: `${erro.name}${erro.code ? ` [${erro.code}]` : ''}: ${erro.message}`.slice(0, 2000),
  });
}

// Uso direto (scripts/CLI), sem fila: N CNPJs de um tipo com concorrência limitada.
// Na aplicação, prefira a fila (queue/dispatcher.js), que tem retry com backoff e sobrevive a restart.
async function emitirLoteDireto(tipo, empresas, { concorrencia = 5, loteId } = {}) {
  const resultados = new Array(empresas.length);
  let i = 0;
  const trabalhador = async () => {
    while (i < empresas.length) {
      const idx = i++;
      try {
        resultados[idx] = { ok: true, ...(await emitirCertidao({ tipo, empresa: empresas[idx], loteId })) };
      } catch (erro) {
        await registrarFalha({ tipo, empresa: empresas[idx], loteId, tentativas: 1, erro }).catch(() => {});
        resultados[idx] = { ok: false, cnpj: empresas[idx].cnpj, erro: erro.message };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concorrencia, empresas.length) }, trabalhador));
  return resultados;
}

module.exports = { emitirCertidao, registrarFalha, emitirLoteDireto };
