const config = require('../config');
const repo = require('../database/repository');
const { analisar, alertasVencimento, tiposParaEmitir } = require('./analisador');
const { notificarAlertas } = require('./notificador');
const { dispararLote } = require('../queue/dispatcher');
const { FILAS, getQueue } = require('../queue/queues');

// Agenda a varredura diária no BullMQ (idempotente: pode chamar a cada boot do worker).
// Job scheduler no Redis = só UMA execução por horário, mesmo com vários workers rodando.
async function agendarRaioX() {
  const { cron, tz } = config.raioX;
  await getQueue(FILAS.raioX).upsertJobScheduler(
    'raio-x-diario',
    { pattern: cron, tz },
    { name: 'varredura', opts: { attempts: 3, backoff: { type: 'exponential', delay: 60000 } } },
  );
  return { cron, tz };
}

// Varredura da madrugada: todos os CNPJs ativos → decide o que emitir → dispara em paralelo.
async function varredura() {
  const cfg = config.raioX;
  const empresas = await repo.listarEmpresasAtivas();
  const alertasCriados = [];

  // Leituras em paralelo (Promise.all em blocos para não esgotar o pool do Postgres)
  const itens = [];
  for (let i = 0; i < empresas.length; i += 50) {
    const bloco = await Promise.all(empresas.slice(i, i + 50).map(async (empresa) => {
      const vig = await repo.vigentes(empresa.cnpj);
      const tipos = tiposParaEmitir(empresa, vig, cfg);
      // Tipos que NÃO serão re-emitidos ainda precisam de alerta de vencimento
      const pulados = vig.filter((v) => !tipos.includes(v.tipo));
      const alertas = pulados.flatMap((v) => alertasVencimento({ ...v, cnpj: empresa.cnpj }, cfg));
      await registrarENotificar(empresa.cnpj, alertas, alertasCriados);
      return { cnpj: empresa.cnpj, tipos };
    }));
    itens.push(...bloco);
  }

  // Certificados A1 perto de vencer: sem eles o Serpro/Integra Contador para de funcionar
  const certs = await repo.certificadosVencendo(cfg.diasAlertaCertificado);
  for (const c of certs) {
    await registrarENotificar(c.titular_cnpj, [{
      cnpj: c.titular_cnpj, tipo: 'certificado', alerta: 'CERTIFICADO_VENCENDO', severidade: 'alta',
      detalhe: `Certificado A1 #${c.id} vence em ${new Date(c.valido_ate).toLocaleDateString('pt-BR')}`,
    }], alertasCriados);
  }

  const lote = await dispararLote(itens, { origem: 'raio_x' });
  return { empresas: empresas.length, ...lote, alertasPreLote: alertasCriados.length };
}

// Job-pai de cada CNPJ: todos os tipos terminaram (sucesso ou falha definitiva) → compara e alerta.
async function consolidarCnpj({ loteId, cnpj }) {
  const atuais = await repo.certidoesDoLote(loteId, cnpj);
  const alertasCriados = [];
  if (atuais.length) {
    const anteriores = await repo.certidoesAnteriores(cnpj, Math.min(...atuais.map((c) => c.id)));
    const alertas = atuais.flatMap((atual) => analisar({
      atual, anterior: anteriores[atual.tipo], diasAlertaVencimento: config.raioX.diasAlertaVencimento,
    }));
    await registrarENotificar(cnpj, alertas, alertasCriados);
  }
  await repo.finalizarLote(loteId);
  return {
    cnpj,
    emitidas: atuais.filter((c) => c.status === 'EMITIDA').length,
    erros: atuais.filter((c) => c.status === 'ERRO').length,
    alertas: alertasCriados.map((a) => a.alerta),
  };
}

async function registrarENotificar(cnpj, alertas, acumulador) {
  const novos = [];
  for (const a of alertas) {
    const salvo = await repo.inserirAlerta(a); // null = mesmo alerta já registrado hoje
    if (salvo) novos.push(salvo);
  }
  acumulador.push(...novos);
  await notificarAlertas(cnpj, novos).catch((e) => console.error('[raio-x] notificação:', e.message));
}

module.exports = { agendarRaioX, varredura, consolidarCnpj };
