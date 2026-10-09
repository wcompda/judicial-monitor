const { CertidaoAdapter, SITUACOES, classificarSituacao } = require('../adapters/base');
const { resolverServico, carregarCatalogo } = require('./catalogo');
const { toIso } = require('../core/datas');

// Adapter genérico: FGTS, Trabalhista, Estadual, Municipal e Simples Nacional via Broker.
// Envia CNPJ (+ UF / código IBGE quando aplicável), normaliza o JSON e baixa o PDF do recibo.
//
// Cada serviço do broker tem nomes de campo próprios; a normalização tenta os mais comuns
// e cai para classificação por texto. Para um serviço com formato muito diferente, adicione
// um interpretador específico em INTERPRETADORES.
const primeiro = (obj, chaves) => {
  for (const k of chaves) if (obj?.[k] != null && obj[k] !== '') return obj[k];
  return null;
};

const CAMPOS = {
  numero: ['certidao_codigo', 'numero_certidao', 'codigo_controle', 'codigo_certidao', 'numero', 'codigo_autenticidade'],
  emissao: ['emissao_data', 'data_emissao', 'emitida_em', 'data_hora_emissao'],
  validade: ['validade_data', 'data_validade', 'validade', 'validade_fim_data', 'valido_ate'],
  texto: ['situacao', 'status', 'tipo_certidao', 'certidao', 'mensagem', 'resultado', 'conclusao'],
};

const INTERPRETADORES = {
  // Simples Nacional: o que importa é a opção vigente e eventos de exclusão
  simples(d) {
    const texto = JSON.stringify(d).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const exclusao = /exclu(i|sao|ido)/.test(texto);
    const optante = /optante pelo simples nacional|"simples_nacional_situacao":"optante|"optante":true/.test(texto) && !/nao optante/.test(texto);
    return {
      situacao: exclusao ? SITUACOES.POSITIVA : optante ? SITUACOES.NEGATIVA : SITUACOES.INDISPONIVEL,
      extras: { exclusaoSimples: exclusao, optanteSimples: optante },
    };
  },
};

function situacaoGenerica(d) {
  for (const k of ['conseguiu_emitir_certidao_negativa', 'certidao_negativa', 'regular', 'regularidade']) {
    if (typeof d?.[k] === 'boolean') return d[k] ? SITUACOES.NEGATIVA : SITUACOES.POSITIVA;
  }
  const texto = CAMPOS.texto.map((k) => d?.[k]).filter(Boolean).join(' ');
  return classificarSituacao(texto || JSON.stringify(d || {}));
}

class BrokerAdapter extends CertidaoAdapter {
  constructor(tipo, { client, catalogo = carregarCatalogo() }) {
    super(`broker:${tipo}`);
    this.tipo = tipo;
    this.client = client;
    this.catalogo = catalogo;
  }

  async emitir(entrada) {
    const { servico, parametros } = resolverServico(this.tipo, entrada, this.catalogo);
    const r = await this.client.consultar(servico, parametros);
    const d = r.dados[0] || {};

    let situacao;
    let extras = {};
    if (r.code !== 200 || !r.dados.length) {
      situacao = SITUACOES.INDISPONIVEL; // fonte respondeu "sem dados" → Raio X pede verificação manual
    } else if (INTERPRETADORES[this.tipo]) {
      ({ situacao, extras } = INTERPRETADORES[this.tipo](d));
    } else {
      situacao = situacaoGenerica(d);
    }

    // Recibo: prefere .pdf; o broker devolve URLs temporárias → copiamos o binário para o S3
    const urlPdf = r.recibos.find((u) => /\.pdf(\?|$)/i.test(u)) || r.recibos[0] || null;
    const pdf = urlPdf ? await this.client.baixarPdf(urlPdf) : null;

    return {
      situacao,
      numero: primeiro(d, CAMPOS.numero),
      emitidaEm: toIso(primeiro(d, CAMPOS.emissao)) || (pdf ? new Date().toISOString() : null),
      validaAte: toIso(primeiro(d, CAMPOS.validade)),
      pdf,
      pdfUrlOrigem: urlPdf,
      fonte: `infosimples:${servico}`,
      extras,
      raw: { code: r.code, mensagem: r.mensagem, dados: d },
    };
  }
}

module.exports = { BrokerAdapter, situacaoGenerica, INTERPRETADORES };
