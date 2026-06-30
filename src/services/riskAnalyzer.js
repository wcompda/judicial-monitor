const axios = require('axios');

// ── Palavras-chave estáticas (fallback sem IA) ───────────────────────────────
const RISK_RULES = {
  vermelho: [
    // Restrições patrimoniais
    'penhora', 'penhorado', 'bloqueio judicial', 'bloqueado', 'valor bloqueado',
    'arresto', 'sequestro de bens', 'constrição', 'constrito',
    'indisponibilidade', 'sisbajud', 'renajud', 'bacenjud', 'infojud',
    // Execução
    'execução fiscal', 'cumprimento de sentença', 'execução de título',
    'citação para pagar', 'pagamento em 3 dias', 'intimação para cumprir',
    'decorrido prazo', 'prazo expirado', 'revel', 'revelia',
    // Decisões desfavoráveis
    'condenação', 'condenado', 'procedente contra', 'improcedente',
    'recurso improvido', 'negado provimento', 'multa aplicada', 'astreintes',
    'litigante de má-fé', 'habeas corpus negado', 'decreto de prisão',
    'mandado de prisão', 'prisão civil',
    // Leilão / alienação
    'leilão', 'hasta pública', 'alienação judicial', 'avaliação do bem',
    // Tutela urgente contra
    'liminar deferida contra', 'tutela antecipada deferida contra',
    'tutela de urgência deferida contra',
    // Débito / inadimplência
    'débito', 'protesto', 'inadimplência', 'inadimplente',
    // Despejo
    'despejo', 'reintegração de posse contra',
    // Fraude
    'fraude', 'contempt',
  ],
  amarelo: [
    // Citação / intimação
    'citação', 'citado', 'intimação', 'intimado',
    'publicado intimação', 'publicada intimação', 'publicado no dj', 'publicação no diário',
    // Audiência
    'audiência', 'audiência designada',
    // Prazo
    'prazo', 'prazo para contestar', 'prazo para recurso', 'prazo processual',
    // Recursos
    'recurso interposto', 'apelação', 'agravo', 'agravo de instrumento',
    'embargos', 'embargos à execução', 'embargos de terceiro',
    'recurso especial', 'recurso extraordinário',
    // Andamento
    'oposição', 'contestação pendente', 'perícia', 'pericial', 'avaliação',
    'notificação', 'diligência', 'carga dos autos', 'vista', 'manifestação',
    'impugnação', 'exceção', 'incidente', 'medida cautelar',
    'antecipação de tutela requerida', 'liminar requerida',
    'distribuído', 'autuado', 'recebida a inicial',
    'concluso para despacho', 'aguardando julgamento', 'pauta de julgamento',
    'remetido ao ministério público', 'determinado cumprimento',
    'processo reativado', 'reativado',
    'despacho', 'despacho de mero expediente', 'proferido despacho',
    'juntada de petição', 'expedição de carta', 'carta precatória',
    // Sentenças / decisões neutras
    'sentença', 'acórdão', 'decisão interlocutória',
    'trânsito em julgado', 'mandado de segurança',
    // Tutela / liminar requerida
    'tutela de urgência', 'tutela antecipada', 'liminar',
    // Outros
    'busca e apreensão', 'alienação fiduciária',
    // Financeiro
    'custas processuais', 'honorários sucumbenciais',
    'depósito judicial', 'precatório', 'rpv',
    // Inventário / herança
    'habilitação de herdeiros', 'inventário',
    // Desarquivamento
    'desarquivamento',
  ],
  verde: [
    'arquivado', 'arquivamento', 'arquivado definitivamente',
    'extinto', 'extinção', 'extinção do processo', 'processo extinto',
    'procedente a favor', 'provido', 'recurso provido', 'sentença favorável',
    'julgado procedente', 'tutela concedida', 'liminar concedida', 'medida deferida',
    'acordo homologado', 'transação', 'conciliação', 'desistência',
    'quitação', 'pagamento confirmado',
    'liberação', 'levantamento do bloqueio', 'levantamento de valores',
    'desbloqueio', 'desbloqueado', 'valores liberados', 'devolução de valores',
    'cancelamento da penhora', 'desconstituição',
    'revogação da liminar contra', 'habeas corpus concedido',
    'absolvição', 'absolvido',
    'certidão de baixa', 'baixa definitiva',
    'alvará judicial', 'expedição de alvará', 'liberação de depósito judicial',
  ]
};

// ── Categorias por tipo de evento ────────────────────────────────────────────
const CATEGORIAS = {
  'Restrição patrimonial': ['penhora', 'bloqueio', 'arresto', 'sequestro', 'sisbajud', 'renajud', 'bacenjud', 'infojud', 'indisponibilidade', 'constrição'],
  'Decisão judicial': ['sentença', 'acórdão', 'decisão interlocutória', 'despacho', 'trânsito em julgado'],
  'Prazo processual': ['prazo', 'intimação', 'citação', 'audiência', 'decorrido prazo', 'prazo expirado'],
  'Recurso': ['apelação', 'agravo', 'embargos', 'recurso especial', 'recurso extraordinário'],
  'Tutela / liminar': ['liminar', 'tutela de urgência', 'tutela antecipada', 'mandado de segurança'],
  'Execução / cobrança': ['execução', 'cumprimento de sentença', 'leilão', 'hasta pública', 'pagar'],
  'Liberação / favorável': ['desbloqueio', 'levantamento', 'alvará', 'liberação', 'arquivado', 'acordo', 'quitação'],
  'Financeiro': ['depósito judicial', 'precatório', 'rpv', 'honorários', 'custas', 'devolução de valores'],
};

// ── Análise básica por palavras-chave ────────────────────────────────────────
function analyzeRisk(texto) {
  const t = (texto || '').toLowerCase();
  for (const p of RISK_RULES.vermelho) { if (t.includes(p)) return 'vermelho'; }
  for (const p of RISK_RULES.amarelo)  { if (t.includes(p)) return 'amarelo';  }
  for (const p of RISK_RULES.verde)    { if (t.includes(p)) return 'verde';    }
  return 'azul';
}

function getCategoria(texto) {
  const t = (texto || '').toLowerCase();
  for (const [cat, palavras] of Object.entries(CATEGORIAS)) {
    if (palavras.some(p => t.includes(p))) return cat;
  }
  return 'Andamento processual';
}

// ── Análise inteligente via Claude ───────────────────────────────────────────
async function analyzeRiskIA(texto, numero, tribunal) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null; // sem chave, usa fallback

  try {
    const prompt = `Você é especialista em direito processual brasileiro. Analise esta movimentação judicial e responda APENAS com JSON válido, sem texto extra:

Processo: ${numero || 'não informado'} | Tribunal: ${tribunal || 'não informado'}
Movimentação: "${texto}"

Retorne:
{
  "risco": "vermelho|amarelo|verde|azul",
  "prioridade": "Alta|Média|Baixa",
  "categoria": "categoria do evento",
  "resumo": "resumo em 1 frase simples para leigo",
  "providencia": "o que o cidadão deve fazer agora (ou null se não precisar de ação)"
}

Critérios de risco:
- vermelho: bloqueio, penhora, execução, leilão, condenação, prazo expirado, SISBAJUD
- amarelo: citação, intimação, audiência, prazo, recurso, decisão neutra
- verde: desbloqueio, arquivamento, acordo, decisão favorável, levantamento de valores
- azul: andamento de rotina sem impacto imediato`;

    const resp = await axios.post('https://api.anthropic.com/v1/messages', {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    }, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      timeout: 8000
    });

    const jsonMatch = resp.data.content[0].text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (e) {
    console.warn('[riskAnalyzer] IA indisponível, usando fallback:', e.message);
    return null;
  }
}

function analyzeProcessoRisco(movimentacoes) {
  if (!movimentacoes || movimentacoes.length === 0) return 'azul';
  const riscos = movimentacoes.map(m => analyzeRisk(m.descricao));
  if (riscos.includes('vermelho')) return 'vermelho';
  if (riscos.includes('amarelo')) return 'amarelo';
  if (riscos.includes('verde')) return 'verde';
  return 'azul';
}

function getRiskLabel(risco) {
  return {
    vermelho: '🔴 ATENÇÃO URGENTE — Risco de prejuízo',
    amarelo:  '🟡 ATENÇÃO — Movimentação importante',
    verde:    '🟢 FAVORÁVEL — Boa notícia',
    azul:     '🔵 INFORMATIVO — Atualização de rotina'
  }[risco] || '🔵 INFORMATIVO';
}

module.exports = { analyzeRisk, analyzeRiskIA, analyzeProcessoRisco, getRiskLabel, getCategoria };
