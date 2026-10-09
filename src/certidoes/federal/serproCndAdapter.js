const axios = require('axios');
const { CertidaoAdapter, SITUACOES } = require('../adapters/base');
const { SerproAuth } = require('./serproAuth');
const { PermanentError, TransientError, fromHttpError } = require('../core/errors');
const { toIso } = require('../core/datas');

// Esfera FEDERAL — Certidão Conjunta RFB/PGFN via API oficial Consulta CND (Serpro). Sem scraping.
//
// Fluxo da API: valida o CNPJ → se já existe certidão válida, devolve a mais recente;
// senão, solicita emissão ao sistema de CND. Validade padrão de 180 dias.
//
// ⚠️ Os nomes de campos abaixo seguem a documentação "Documentacao_API_CND.pdf" (v1).
//    Confirme-os no seu contrato da Loja Serpro antes de ir para produção — ficam todos
//    concentrados em montarRequisicao() / interpretarResposta() para facilitar o ajuste.
class SerproCndAdapter extends CertidaoAdapter {
  constructor(cfg, { http = axios, vault, auth } = {}) {
    super('serpro:consulta-cnd');
    this.cfg = cfg;
    this.http = http;
    this.vault = vault;
    this.auths = new Map(); // certificadoId → SerproAuth (um token OAuth + um https.Agent por certificado)
    if (auth) this.auths.set('default', auth);
  }

  // Resolve o SerproAuth do certificado A1 da empresa (ou o da aplicação, se não houver)
  async authPara(certificadoId) {
    const chave = certificadoId || 'default';
    if (!this.auths.has(chave)) {
      const certificado = certificadoId && this.vault ? await this.vault.obter(certificadoId) : null;
      this.auths.set(chave, new SerproAuth(this.cfg, { certificado, http: this.http }));
    }
    return this.auths.get(chave);
  }

  montarRequisicao(cnpj) {
    return {
      TipoContribuinte: this.cfg.tipoContribuintePJ,
      ContribuinteConsulta: cnpj,
      CodigoIdentificacao: this.cfg.codigoIdentificacaoPJ,
      GerarCertidaoPdf: true,
    };
  }

  async emitir({ cnpj, certificadoId }) {
    const auth = await this.authPara(certificadoId);
    const body = this.montarRequisicao(cnpj);
    let resp;
    try {
      resp = await this.#post(auth, body);
    } catch (err) {
      // Token revogado/expirado no meio do caminho: renova uma vez e tenta de novo
      if (err.response?.status === 401) {
        auth.invalidar();
        try {
          resp = await this.#post(auth, body);
        } catch (err2) {
          throw fromHttpError(err2, 'Serpro Consulta CND');
        }
      } else {
        throw fromHttpError(err, 'Serpro Consulta CND');
      }
    }
    return this.interpretarResposta(resp.data);
  }

  async #post(auth, body) {
    const headers = { ...(await auth.getHeaders()), 'Content-Type': 'application/json', Accept: 'application/json' };
    return this.http.post(this.cfg.cndUrl, body, {
      headers,
      httpsAgent: auth.httpsAgent,
      timeout: this.cfg.timeoutMs,
    });
  }

  interpretarResposta(data = {}) {
    const mensagens = []
      .concat(data.Mensagem || data.Mensagens || [])
      .map((m) => (typeof m === 'string' ? m : m?.texto || m?.Texto || JSON.stringify(m)));
    const cert = data.Certidao || null;

    if (!cert) {
      // Sem certidão: ou há pendências (positiva, sem PDF) ou o sistema de CND está indisponível.
      const texto = mensagens.join(' ').toLowerCase();
      if (/indispon|tente novamente|timeout|tempor/.test(texto)) {
        throw new TransientError(`Serpro CND indisponível: ${mensagens.join(' | ')}`, { code: data.Status });
      }
      if (/inv[aá]lid|n[aã]o encontrad|inexistente/.test(texto)) {
        throw new PermanentError(`Serpro CND recusou o CNPJ: ${mensagens.join(' | ')}`, { code: data.Status });
      }
      return {
        situacao: SITUACOES.POSITIVA,
        numero: null,
        emitidaEm: null,
        validaAte: null,
        pdf: null,
        fonte: this.nome,
        raw: { Status: data.Status, Mensagem: mensagens },
      };
    }

    const tipo = String(cert.TipoCertidao || '').toUpperCase();
    const situacao = /POSITIVA.*EFEITO/.test(tipo) ? SITUACOES.POSITIVA_COM_EFEITO_NEGATIVA
      : /POSITIVA/.test(tipo) ? SITUACOES.POSITIVA
      : SITUACOES.NEGATIVA;

    // PDF chega em base64 dentro do JSON → Buffer (nunca string no Redis)
    const pdf = cert.DocumentoPdf ? Buffer.from(cert.DocumentoPdf, 'base64') : null;
    if (pdf && pdf.subarray(0, 4).toString() !== '%PDF') {
      throw new TransientError('Serpro CND devolveu DocumentoPdf corrompido');
    }

    return {
      situacao,
      numero: cert.CodigoControle || null,
      emitidaEm: toIso(cert.DataEmissao),
      validaAte: toIso(cert.DataValidade),
      pdf,
      fonte: this.nome,
      raw: { Status: data.Status, Mensagem: mensagens, TipoCertidao: cert.TipoCertidao },
    };
  }
}

module.exports = { SerproCndAdapter };
