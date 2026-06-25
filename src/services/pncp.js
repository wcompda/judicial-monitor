const axios = require('axios');

const PNCP_BASE = 'https://pncp.gov.br/api/pncp/v1';
const TRANSP_BASE = 'https://api.portaldatransparencia.gov.br/api-de-dados';

const http = axios.create({ timeout: 15000, headers: { 'Accept': 'application/json' } });

// ── PNCP — busca contratos por CNPJ fornecedor ──────────────────────────────

async function buscarContratosPNCP(cnpj) {
  const cnpjLimpo = cnpj.replace(/\D/g, '');
  const resultados = [];
  try {
    let pagina = 1;
    while (true) {
      const { data } = await http.get(`${PNCP_BASE}/contratos`, {
        params: { cnpjFornecedor: cnpjLimpo, pagina, tamanhoPagina: 50 }
      });
      const itens = data?.data || data?.contratos || [];
      if (!itens.length) break;
      resultados.push(...itens);
      if (itens.length < 50) break;
      pagina++;
      if (pagina > 5) break; // máx 250 registros
    }
    console.log(`[PNCP] ${resultados.length} contrato(s) encontrado(s) para CNPJ ${cnpjLimpo}`);
  } catch (e) {
    console.error(`[PNCP] Erro ao buscar CNPJ ${cnpjLimpo}: ${e.message}`);
  }
  return resultados;
}

// ── Portal da Transparência — contratos por CNPJ ────────────────────────────

async function buscarTransparenciaCNPJ(cnpj) {
  const apiKey = process.env.TRANSPARENCIA_API_KEY;
  if (!apiKey) return [];
  const cnpjLimpo = cnpj.replace(/\D/g, '');
  const resultados = [];
  try {
    let pagina = 1;
    while (true) {
      const { data } = await http.get(`${TRANSP_BASE}/contratos/cnpj`, {
        params: { cnpj: cnpjLimpo, pagina, quantidade: 100 },
        headers: { 'chave-api-dados': apiKey }
      });
      if (!Array.isArray(data) || !data.length) break;
      resultados.push(...data);
      if (data.length < 100) break;
      pagina++;
      if (pagina > 5) break;
    }
    console.log(`[TRANSP] ${resultados.length} contrato(s) CNPJ ${cnpjLimpo}`);
  } catch (e) {
    console.error(`[TRANSP] Erro CNPJ ${cnpjLimpo}: ${e.message}`);
  }
  return resultados;
}

// ── Portal da Transparência — contratos por CPF ─────────────────────────────

async function buscarTransparenciaCPF(cpf) {
  const apiKey = process.env.TRANSPARENCIA_API_KEY;
  if (!apiKey) return [];
  const cpfLimpo = cpf.replace(/\D/g, '');
  const resultados = [];
  try {
    let pagina = 1;
    while (true) {
      const { data } = await http.get(`${TRANSP_BASE}/contratos/cpf`, {
        params: { cpf: cpfLimpo, pagina, quantidade: 100 },
        headers: { 'chave-api-dados': apiKey }
      });
      if (!Array.isArray(data) || !data.length) break;
      resultados.push(...data);
      if (data.length < 100) break;
      pagina++;
      if (pagina > 5) break;
    }
    console.log(`[TRANSP] ${resultados.length} contrato(s) CPF ${cpfLimpo}`);
  } catch (e) {
    console.error(`[TRANSP] Erro CPF ${cpfLimpo}: ${e.message}`);
  }
  return resultados;
}

// ── Normalizar resultado PNCP para formato interno ──────────────────────────

function normalizarContratoPNCP(item) {
  const numero = item.numeroContratoOuInstrumentoAnalogoProprioOrgao
    || item.numeroContrato
    || item.numero
    || `PNCP-${Date.now()}`;
  const orgao = item.orgaoEntidade?.razaoSocial || item.nomeOrgao || 'Órgão';
  const valor = item.valorGlobal || item.valorInicial || 0;
  const objeto = item.objetoContrato || item.objeto || 'Contrato público';
  const dataVigencia = item.dataVigenciaFim || item.dataAssinatura || item.dataPublicacaoPncp;
  const dataAssinatura = item.dataAssinatura || item.dataPublicacaoPncp;

  return {
    id: `pncp-${numero}-${orgao}`.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 100),
    numero,
    tribunal: 'PNCP',
    classe: 'Contrato Público',
    assunto: objeto.substring(0, 500),
    situacao: item.situacaoContrato || 'Ativo',
    valor_causa: valor,
    data_distribuicao: dataAssinatura,
    ultima_movimentacao: dataVigencia || dataAssinatura,
    partes: JSON.stringify([
      { polo: 'CONTRATANTE', nome: orgao },
      { polo: 'CONTRATADO', nome: item.nomeRazaoSocialFornecedor || 'WCOMTEC' }
    ])
  };
}

// ── Normalizar resultado Transparência ──────────────────────────────────────

function normalizarContratoTransparencia(item) {
  const numero = item.numero || item.id || `TR-${Date.now()}`;
  const orgao = item.unidadeGestora?.orgaoVinculado?.nome || item.orgao?.nome || 'Órgão Federal';
  const valor = item.valor || 0;
  const objeto = item.objeto || 'Contrato federal';

  return {
    id: `transp-${numero}`.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 100),
    numero: String(numero),
    tribunal: 'GOV-FEDERAL',
    classe: 'Contrato Federal',
    assunto: objeto.substring(0, 500),
    situacao: item.situacao?.descricao || 'Ativo',
    valor_causa: valor,
    data_distribuicao: item.dataInicioVigencia || item.dataAssinatura,
    ultima_movimentacao: item.dataFimVigencia || item.dataAssinatura,
    partes: JSON.stringify([
      { polo: 'CONTRATANTE', nome: orgao },
      { polo: 'CONTRATADO', nome: item.fornecedor?.nome || 'WCOMTEC' }
    ])
  };
}

// ── Busca unificada ──────────────────────────────────────────────────────────

async function buscarContratos(cpf, cnpj) {
  const [pncpCNPJ, transpCNPJ, transpCPF] = await Promise.allSettled([
    buscarContratosPNCP(cnpj),
    buscarTransparenciaCNPJ(cnpj),
    buscarTransparenciaCPF(cpf),
  ]);

  const contratos = [];

  for (const item of (pncpCNPJ.value || [])) {
    try { contratos.push(normalizarContratoPNCP(item)); } catch {}
  }
  for (const item of (transpCNPJ.value || [])) {
    try { contratos.push(normalizarContratoTransparencia(item)); } catch {}
  }
  for (const item of (transpCPF.value || [])) {
    try { contratos.push(normalizarContratoTransparencia(item)); } catch {}
  }

  // Deduplicar por id
  const vistos = new Set();
  return contratos.filter(c => {
    if (vistos.has(c.id)) return false;
    vistos.add(c.id);
    return true;
  });
}

module.exports = { buscarContratos };
