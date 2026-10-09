// Raio X Fiscal: compara a certidão nova com a anterior do mesmo tipo e gera alertas.
// Função pura (sem I/O) — fácil de testar e de evoluir as regras.

const DIA = 86400000;

function analisar({ atual, anterior, agora = new Date(), diasAlertaVencimento = 15 }) {
  const alertas = [];
  const add = (alerta, severidade, detalhe) => alertas.push({
    cnpj: atual.cnpj, tipo: atual.tipo, alerta, severidade, detalhe, certidaoId: atual.id,
  });

  if (atual.status === 'ERRO') {
    add('FALHA_EMISSAO', 'media', atual.erro);
    return alertas;
  }

  const sit = atual.situacao;
  const sitAnterior = anterior?.situacao;
  const extras = atual.raw?.extras || {};
  const exclusaoSimples = atual.tipo === 'simples' && extras.exclusaoSimples;

  if (exclusaoSimples) {
    add('EXCLUSAO_SIMPLES', 'alta', 'Termo/evento de exclusão do Simples Nacional encontrado');
  } else if (sit === 'POSITIVA' && sitAnterior !== 'POSITIVA') {
    add('NOVA_PENDENCIA', 'alta', sitAnterior
      ? `Situação mudou de ${sitAnterior} para POSITIVA`
      : 'Primeira consulta já com pendência');
  }
  if (sitAnterior === 'POSITIVA' && ['NEGATIVA', 'POSITIVA_COM_EFEITO_NEGATIVA'].includes(sit)) {
    add('REGULARIZADA', 'baixa', `Situação mudou de POSITIVA para ${sit}`);
  }
  if (sit === 'INDISPONIVEL') {
    add('VERIFICAR_MANUALMENTE', 'media', 'A fonte não devolveu certidão nem situação conclusiva');
  }

  alertas.push(...alertasVencimento(atual, { agora, diasAlertaVencimento }));
  return alertas;
}

function alertasVencimento(cert, { agora = new Date(), diasAlertaVencimento = 15 }) {
  if (!cert.valida_ate) return [];
  const restante = new Date(cert.valida_ate).getTime() - agora.getTime();
  const base = { cnpj: cert.cnpj, tipo: cert.tipo, certidaoId: cert.id };
  if (restante < 0) return [{ ...base, alerta: 'VENCIDA', severidade: 'alta', detalhe: `Venceu em ${fmt(cert.valida_ate)}` }];
  if (restante <= diasAlertaVencimento * DIA) {
    return [{ ...base, alerta: 'VENCIMENTO_PROXIMO', severidade: 'media', detalhe: `Vence em ${Math.ceil(restante / DIA)} dia(s) (${fmt(cert.valida_ate)})` }];
  }
  return [];
}

const fmt = (d) => new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

// Quais tipos o Raio X precisa re-emitir hoje para este CNPJ.
// Por padrão re-emite tudo (é o que detecta débito novo mesmo com CND vigente).
// Com reemitirVigentes=false, pula as NEGATIVAS que ainda valem > diasReemissao (economiza chamadas pagas).
function tiposParaEmitir(empresa, vigentes, { reemitirVigentes = true, diasReemissao = 10, agora = new Date() } = {}) {
  if (reemitirVigentes) return empresa.tipos;
  const limite = agora.getTime() + diasReemissao * DIA;
  const pular = new Set(vigentes
    .filter((v) => v.situacao === 'NEGATIVA' && v.valida_ate && new Date(v.valida_ate).getTime() > limite)
    .map((v) => v.tipo));
  return empresa.tipos.filter((t) => !pular.has(t));
}

module.exports = { analisar, alertasVencimento, tiposParaEmitir };
