const axios = require('axios');
require('dotenv').config();

const BASE_URL = 'https://api-publica.datajud.cnj.jus.br';
const API_KEY = process.env.DATAJUD_API_KEY || 'APIKey cDZHYzlZa0JadVREZDJCendQbXY6SkJlTzNjLV9TRENyQk1RdnFKZGRQdw==';

// Índices dos principais tribunais
const TRIBUNAIS = [
  { codigo: 'tjsp', nome: 'TJSP - São Paulo' },
  { codigo: 'tjrj', nome: 'TJRJ - Rio de Janeiro' },
  { codigo: 'tjmg', nome: 'TJMG - Minas Gerais' },
  { codigo: 'tjrs', nome: 'TJRS - Rio Grande do Sul' },
  { codigo: 'tjpr', nome: 'TJPR - Paraná' },
  { codigo: 'tjsc', nome: 'TJSC - Santa Catarina' },
  { codigo: 'tjba', nome: 'TJBA - Bahia' },
  { codigo: 'tjgo', nome: 'TJGO - Goiás' },
  { codigo: 'tjpe', nome: 'TJPE - Pernambuco' },
  { codigo: 'tjce', nome: 'TJCE - Ceará' },
  { codigo: 'tjma', nome: 'TJMA - Maranhão' },
  { codigo: 'tjmt', nome: 'TJMT - Mato Grosso' },
  { codigo: 'tjms', nome: 'TJMS - Mato Grosso do Sul' },
  { codigo: 'tjpa', nome: 'TJPA - Pará' },
  { codigo: 'trf1', nome: 'TRF1 - 1ª Região' },
  { codigo: 'trf2', nome: 'TRF2 - 2ª Região' },
  { codigo: 'trf3', nome: 'TRF3 - 3ª Região' },
  { codigo: 'trf4', nome: 'TRF4 - 4ª Região' },
  { codigo: 'trf5', nome: 'TRF5 - 5ª Região' },
  { codigo: 'tst', nome: 'TST - Tribunal Superior do Trabalho' },
  { codigo: 'stj', nome: 'STJ - Superior Tribunal de Justiça' },
];

const headers = {
  'Authorization': API_KEY.startsWith('APIKey') ? API_KEY : `APIKey ${API_KEY}`,
  'Content-Type': 'application/json'
};

async function buscarPorNome(nome, tribunal) {
  try {
    const body = {
      query: {
        bool: {
          should: [
            { match: { 'partes.nome': { query: nome, operator: 'and' } } },
            { match: { 'partes.nome': nome } }
          ],
          minimum_should_match: 1
        }
      },
      size: 20,
      sort: [{ 'dataAjuizamento': { order: 'desc' } }]
    };

    const url = `${BASE_URL}/api_publica_${tribunal}/_search`;
    const { data } = await axios.post(url, body, { headers, timeout: 10000 });

    return (data.hits?.hits || []).map(hit => normalizeProcesso(hit._source, tribunal));
  } catch (err) {
    console.error(`Erro ao buscar em ${tribunal}:`, err.message);
    return [];
  }
}

async function buscarPorCpf(cpf, tribunal) {
  const cpfLimpo = cpf.replace(/\D/g, '');
  try {
    const body = {
      query: {
        nested: {
          path: 'partes',
          query: {
            bool: {
              should: [
                { match: { 'partes.documento.valor': cpfLimpo } },
                { match: { 'partes.cpf': cpfLimpo } }
              ],
              minimum_should_match: 1
            }
          }
        }
      },
      size: 20,
      sort: [{ 'dataAjuizamento': { order: 'desc' } }]
    };

    const url = `${BASE_URL}/api_publica_${tribunal}/_search`;
    const { data } = await axios.post(url, body, { headers, timeout: 10000 });
    return (data.hits?.hits || []).map(hit => normalizeProcesso(hit._source, tribunal));
  } catch {
    return [];
  }
}

async function buscarPorNumero(numero) {
  const numeroLimpo = numero.replace(/\D/g, '');
  const resultados = [];

  for (const t of TRIBUNAIS) {
    try {
      const body = {
        query: { match: { 'numeroProcesso': numero } },
        size: 5
      };
      const url = `${BASE_URL}/api_publica_${t.codigo}/_search`;
      const { data } = await axios.post(url, body, { headers, timeout: 8000 });
      const hits = (data.hits?.hits || []).map(h => normalizeProcesso(h._source, t.codigo));
      resultados.push(...hits);
      if (resultados.length > 0) break;
    } catch {}
  }

  return resultados;
}

async function buscarMovimentacoes(numero, tribunal) {
  try {
    const body = {
      query: { match: { 'numeroProcesso': numero } },
      size: 1
    };
    const url = `${BASE_URL}/api_publica_${tribunal}/_search`;
    const { data } = await axios.post(url, body, { headers, timeout: 10000 });
    const hit = data.hits?.hits?.[0]?._source;
    if (!hit) return [];
    return (hit.movimentos || []).map(m => ({
      data: m.dataHora || m.data,
      descricao: m.nome || m.complementosTabelados?.map(c => c.descricao).join(', ') || 'Movimentação registrada',
      codigo: m.codigo
    }));
  } catch (err) {
    console.error(`Erro ao buscar movimentações:`, err.message);
    return [];
  }
}

async function buscarTodosProcessos(nome, cpf) {
  console.log(`Buscando processos para: ${nome}${cpf ? ` (CPF: ${cpf})` : ''}`);
  const todos = [];
  const idsVistos = new Set();

  for (const t of TRIBUNAIS) {
    console.log(`  -> Consultando ${t.nome}...`);
    const porNome = await buscarPorNome(nome, t.codigo);
    const porCpf = cpf ? await buscarPorCpf(cpf, t.codigo) : [];

    for (const p of [...porNome, ...porCpf]) {
      if (!idsVistos.has(p.id)) {
        idsVistos.add(p.id);
        todos.push(p);
      }
    }
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`Total encontrado: ${todos.length} processos`);
  return todos;
}

function normalizeProcesso(source, tribunal) {
  return {
    id: `${tribunal}_${source.numeroProcesso}`,
    numero: source.numeroProcesso || '',
    tribunal: tribunal.toUpperCase(),
    classe: source.classe?.nome || '',
    assunto: source.assuntos?.map(a => a.nome).join(', ') || '',
    situacao: source.movimentos?.[0]?.nome || 'Em andamento',
    partes: JSON.stringify(source.partes || []),
    valor_causa: source.valorCausa || 0,
    data_distribuicao: source.dataAjuizamento || '',
    ultima_movimentacao: source.movimentos?.[0]?.dataHora || '',
    movimentos: source.movimentos || []
  };
}

module.exports = { buscarTodosProcessos, buscarPorNumero, buscarMovimentacoes, TRIBUNAIS };
