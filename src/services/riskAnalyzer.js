// Palavras-chave para classificação de risco por cor
const RISK_RULES = {
  vermelho: [
    'penhora', 'penhorado', 'bloqueio', 'bloqueado', 'arresto', 'sequestro de bens',
    'execução fiscal', 'mandado de prisão', 'prisão civil', 'liminar deferida contra',
    'tutela antecipada deferida contra', 'condenação', 'condenado', 'procedente contra',
    'improcedente', 'recurso improvido', 'negado provimento', 'débito', 'protesto',
    'inadimplência', 'inadimplente', 'despejo', 'reintegração de posse contra',
    'execução de título', 'fraude', 'litigante de má-fé', 'multa aplicada',
    'astreintes', 'contempt', 'habeas corpus negado', 'decreto de prisão',
    'leilão', 'hasta pública', 'alienação judicial', 'avalição do bem',
    'citação para pagar', 'pagamento em 3 dias', 'intimação para cumprir'
  ],
  amarelo: [
    'citação', 'citado', 'intimação', 'intimado', 'audiência', 'audiência designada',
    'prazo', 'prazo para contestar', 'prazo para recurso', 'recurso interposto',
    'apelação', 'agravo', 'embargos', 'oposição', 'contestação pendente',
    'perícia', 'pericial', 'avaliação', 'notificação', 'diligência',
    'carga dos autos', 'vista', 'manifestação', 'impugnação', 'exceção',
    'incidente', 'medida cautelar', 'antecipação de tutela requerida',
    'liminar requerida', 'distribuído', 'autuado', 'recebida a inicial',
    'concluso para despacho', 'aguardando julgamento', 'pauta de julgamento',
    'remetido ao ministério público', 'determinado cumprimento'
  ],
  verde: [
    'arquivado', 'arquivamento', 'extinto', 'extinção', 'procedente a favor',
    'provido', 'recurso provido', 'sentença favorável', 'julgado procedente',
    'tutela concedida', 'liminar concedida', 'medida deferida',
    'acordo homologado', 'transação', 'conciliação', 'desistência',
    'quitação', 'pagamento confirmado', 'liberação', 'levantamento do bloqueio',
    'cancelamento da penhora', 'desconstituição', 'revogação da liminar contra',
    'habeas corpus concedido', 'absolvição', 'absolvido'
  ]
};

function analyzeRisk(texto) {
  const textoLower = (texto || '').toLowerCase();

  for (const palavra of RISK_RULES.vermelho) {
    if (textoLower.includes(palavra)) return 'vermelho';
  }
  for (const palavra of RISK_RULES.amarelo) {
    if (textoLower.includes(palavra)) return 'amarelo';
  }
  for (const palavra of RISK_RULES.verde) {
    if (textoLower.includes(palavra)) return 'verde';
  }
  return 'azul';
}

function analyzeProcessoRisk(movimentacoes) {
  if (!movimentacoes || movimentacoes.length === 0) return 'azul';

  const riscos = movimentacoes.map(m => analyzeRisk(m.descricao));

  if (riscos.includes('vermelho')) return 'vermelho';
  if (riscos.includes('amarelo')) return 'amarelo';
  if (riscos.includes('verde')) return 'verde';
  return 'azul';
}

function getRiskLabel(risco) {
  const labels = {
    vermelho: '🔴 ATENÇÃO URGENTE — Risco de prejuízo',
    amarelo: '🟡 ATENÇÃO — Movimentação importante',
    verde:   '🟢 FAVORÁVEL — Boa notícia',
    azul:    '🔵 INFORMATIVO — Atualização de rotina'
  };
  return labels[risco] || labels.azul;
}

module.exports = { analyzeRisk, analyzeProcessoRisk, getRiskLabel };
