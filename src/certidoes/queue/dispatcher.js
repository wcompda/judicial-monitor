const crypto = require('crypto');
const repo = require('../database/repository');
const { TIPOS } = require('../adapters/registry');
const { FILAS, getFlowProducer, opcoesFilho } = require('./queues');

// Fan-out: para cada CNPJ, um job-pai ("consolidar") com um filho por tipo de certidão.
// Todos os filhos entram nas filas AO MESMO TEMPO e rodam em paralelo (limitados só pela
// concorrência de cada worker). O pai só executa quando todos os filhos terminaram.
//
//   lote ─┬─ CNPJ A: consolidar ─┬─ federal     (fila federal)
//         │                      ├─ fgts        (fila broker)
//         │                      ├─ trabalhista (fila broker)
//         │                      ├─ estadual    (fila broker)
//         │                      └─ municipal   (fila broker)
//         └─ CNPJ B: ...
//
// O Redis só recebe { loteId, cnpj, tipo } — dados da empresa, certificado e PDF ficam fora dele.
async function dispararLote(itens, { origem = 'api' } = {}) {
  const validos = itens.filter((i) => i.tipos?.length);
  const loteId = crypto.randomUUID();
  await repo.criarLote({ id: loteId, origem, totalCnpjs: validos.length });
  if (!validos.length) {
    await repo.finalizarLote(loteId);
    return { loteId, cnpjs: 0, jobs: 0 };
  }

  const flows = validos.map(({ cnpj, tipos }) => ({
    name: 'consolidar',
    queueName: FILAS.lote,
    data: { loteId, cnpj },
    opts: { jobId: `${loteId}_${cnpj}`, attempts: 3, backoff: { type: 'exponential', delay: 10000 } },
    children: tipos.map((tipo) => ({
      name: tipo,
      queueName: TIPOS[tipo],
      data: { loteId, cnpj, tipo },
      opts: { ...opcoesFilho(), jobId: `${loteId}_${cnpj}_${tipo}` },
    })),
  }));

  await getFlowProducer().addBulk(flows);
  return { loteId, cnpjs: validos.length, jobs: flows.reduce((n, f) => n + f.children.length, 0) };
}

module.exports = { dispararLote };
