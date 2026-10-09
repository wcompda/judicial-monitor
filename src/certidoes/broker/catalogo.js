const { PermanentError } = require('../core/errors');

// Catálogo: qual serviço do broker atende cada (tipo de certidão × UF × município IBGE).
//
// ⚠️ Os slugs abaixo são o formato usado pela Infosimples, mas o catálogo deles muda e depende
//    do que está liberado no SEU contrato. Confira no painel e sobrescreva sem mexer em código via
//    BROKER_CATALOGO_JSON, ex:
//    {"estadual":{"SP":"pge/sp/certidao-debitos"},"municipal":{"3550308":"pref/sp/sao-paulo/cnd"}}
const PADRAO = {
  fgts: 'caixa/regularidade',
  trabalhista: 'tst/cndt',
  simples: 'receita-federal/simples',
  // Fallback federal (se o Serpro estiver fora): certidão conjunta RFB/PGFN pelo broker
  federal: 'receita-federal/pgfn',
  // Estadual por UF; UFs ausentes caem no template
  estadual: {},
  estadualTemplate: 'sefaz/{uf}/certidao-debitos',
  // Municipal por código IBGE (7 dígitos). Sem entrada → usa o serviço unificado, se houver.
  municipal: {},
  municipalUnificado: process.env.BROKER_MUNICIPAL_SERVICO || null,
};

function carregarCatalogo() {
  let extra = {};
  if (process.env.BROKER_CATALOGO_JSON) {
    try {
      extra = JSON.parse(process.env.BROKER_CATALOGO_JSON);
    } catch (e) {
      throw new Error(`BROKER_CATALOGO_JSON inválido: ${e.message}`);
    }
  }
  return {
    ...PADRAO,
    ...extra,
    estadual: { ...PADRAO.estadual, ...(extra.estadual || {}) },
    municipal: { ...PADRAO.municipal, ...(extra.municipal || {}) },
  };
}

// Devolve { servico, parametros } para a chamada ao broker
function resolverServico(tipo, { cnpj, uf, municipioIbge }, catalogo = carregarCatalogo()) {
  switch (tipo) {
    case 'fgts':
    case 'trabalhista':
    case 'simples':
    case 'federal':
      return { servico: catalogo[tipo], parametros: { cnpj } };

    case 'estadual': {
      if (!uf) throw new PermanentError('Empresa sem UF cadastrada', { code: 'SEM_UF' });
      const u = uf.toUpperCase();
      const servico = catalogo.estadual[u] || catalogo.estadualTemplate.replace('{uf}', u.toLowerCase());
      return { servico, parametros: { cnpj } };
    }

    case 'municipal': {
      if (!municipioIbge) throw new PermanentError('Empresa sem código IBGE do município', { code: 'SEM_IBGE' });
      const especifico = catalogo.municipal[municipioIbge];
      if (especifico) return { servico: especifico, parametros: { cnpj } };
      if (catalogo.municipalUnificado) {
        return { servico: catalogo.municipalUnificado, parametros: { cnpj, ibge: municipioIbge, codigo_ibge: municipioIbge } };
      }
      throw new PermanentError(`Município IBGE ${municipioIbge} sem serviço no broker (cadastre em BROKER_CATALOGO_JSON)`, { code: 'MUNICIPIO_NAO_SUPORTADO' });
    }

    default:
      throw new PermanentError(`Tipo de certidão desconhecido: ${tipo}`);
  }
}

module.exports = { resolverServico, carregarCatalogo };
