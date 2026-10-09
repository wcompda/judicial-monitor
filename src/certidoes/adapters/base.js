// Contrato único de todos os emissores (Adapter Pattern).
// A fila só conhece esta interface — não sabe se por trás há REST, Playwright ou broker.
//
//   adapter.emitir({ cnpj, uf, municipioIbge, razaoSocial }) → Promise<ResultadoCertidao>
//
// ResultadoCertidao:
//   {
//     situacao:   'NEGATIVA' | 'POSITIVA_COM_EFEITO_NEGATIVA' | 'POSITIVA' | 'INDISPONIVEL',
//     numero:     string | null,   // código de controle / número da certidão
//     emitidaEm:  ISO string | null,
//     validaAte:  ISO string | null,
//     pdf:        Buffer | null,   // NUNCA vai para o Redis: o worker sobe para o S3 e descarta
//     fonte:      string,          // 'serpro:consulta-cnd', 'playwright:tst', 'infosimples:sefaz-sp'...
//     raw:        object           // resposta crua, mínima, para auditoria
//   }
//
// Erros: lançar TransientError (fila re-tenta) ou PermanentError (fila desiste). Ver core/errors.js.

const SITUACOES = Object.freeze({
  NEGATIVA: 'NEGATIVA',
  POSITIVA_COM_EFEITO_NEGATIVA: 'POSITIVA_COM_EFEITO_NEGATIVA',
  POSITIVA: 'POSITIVA',
  INDISPONIVEL: 'INDISPONIVEL',
});

class CertidaoAdapter {
  constructor(nome) {
    this.nome = nome;
  }

  // eslint-disable-next-line no-unused-vars
  async emitir(entrada) {
    throw new Error(`${this.nome}: emitir() não implementado`);
  }
}

// Heurística comum para classificar o texto devolvido pelos portais
function classificarSituacao(texto = '') {
  const t = texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  if (/POSITIVA COM EFEITOS? (DE )?NEGATIVA/.test(t)) return SITUACOES.POSITIVA_COM_EFEITO_NEGATIVA;
  if (/NADA CONSTA/.test(t)) return SITUACOES.NEGATIVA;
  // "IRREGULAR" antes de "REGULAR", senão uma empresa irregular sairia como negativa
  if (/POSITIVA|IRREGULAR/.test(t)) return SITUACOES.POSITIVA;
  if (/NEGATIVA|\bREGULAR\b/.test(t)) return SITUACOES.NEGATIVA;
  return SITUACOES.INDISPONIVEL;
}

module.exports = { CertidaoAdapter, SITUACOES, classificarSituacao };
