// Diário de Justiça Eletrônico Nacional (DJEN) — API pública do CNJ (Comunica PJe).
// Traz intimações, citações e demais publicações por nome da parte ou por OAB.
// É a fonte que marca o início dos prazos; o DataJud não traz as partes e pode ficar meses sem atualizar.
const axios = require('axios');

const BASE_URL = 'https://comunicaapi.pje.jus.br/api/v1/comunicacao';
const ITENS_POR_PAGINA = 100;

function normalizarNome(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function limparTexto(html, max = 1200) {
  const t = String(html || '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
  return t.length > max ? t.slice(0, max) + '…' : t;
}

async function buscarPagina(params, tentativa = 1) {
  try {
    const res = await axios.get(BASE_URL, { params, timeout: 30000, headers: { Accept: 'application/json' } });
    return res.data || {};
  } catch (err) {
    const status = err.response && err.response.status;
    if ((status === 429 || status >= 500 || !status) && tentativa < 3) {
      await new Promise(r => setTimeout(r, 4000 * tentativa));
      return buscarPagina(params, tentativa + 1);
    }
    throw err;
  }
}

// filtro: { nomeParte } ou { numeroOab, ufOab }; opcional dataDisponibilizacaoInicio (AAAA-MM-DD)
async function buscarComunicacoes(filtro, { maxPaginas = 10 } = {}) {
  const itens = [];
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const data = await buscarPagina({ ...filtro, itensPorPagina: ITENS_POR_PAGINA, pagina });
    const lote = Array.isArray(data.items) ? data.items : [];
    itens.push(...lote);
    if (lote.length < ITENS_POR_PAGINA) break;
    await new Promise(r => setTimeout(r, 1200));
  }
  return itens;
}

// Evita homônimo parcial: o nome procurado tem de ser exatamente o de um destinatário.
function parteConfere(item, nome) {
  const alvo = normalizarNome(nome);
  const dest = Array.isArray(item.destinatarios) ? item.destinatarios : [];
  if (!dest.length) return true;
  return dest.some(d => normalizarNome(d.nome) === alvo);
}

function normalizarComunicacao(item) {
  const tribunal = String(item.siglaTribunal || '').toUpperCase();
  const numero = String(item.numero_processo || '').replace(/\D/g, '');
  const data = String(item.data_disponibilizacao || item.datadisponibilizacao || '').slice(0, 10);
  const tipo = item.tipoComunicacao || 'Publicação';
  const orgao = item.nomeOrgao || '';
  const descricao = [
    `📰 ${tipo} publicada no Diário de Justiça (DJEN) — ${orgao} [DJEN ${item.id}]`,
    limparTexto(item.texto),
    item.link ? `🔗 ${item.link}` : null,
  ].filter(Boolean).join('\n');
  return {
    djenId: item.id,
    marcador: `[DJEN ${item.id}]`,
    processoId: `${tribunal.toLowerCase()}_${numero}`,
    numero, tribunal, data, tipo, orgao, descricao,
    textoLimpo: limparTexto(item.texto, 4000),
    classe: item.nomeClasse || '',
    partes: JSON.stringify((item.destinatarios || []).map(d => ({ nome: d.nome, polo: d.polo }))),
  };
}

module.exports = { buscarComunicacoes, normalizarComunicacao, parteConfere, normalizarNome, limparTexto };
