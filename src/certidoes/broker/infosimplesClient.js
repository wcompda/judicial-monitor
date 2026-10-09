const axios = require('axios');
const { PermanentError, TransientError, fromHttpError } = require('../core/errors');

// Cliente HTTP do Broker Infosimples (API v2).
//   POST {baseUrl}/{servico}   body: { token, timeout, ...parametros }
//   → { code, code_message, errors[], data_count, data[], site_receipts[] }
//
// O broker absorve CAPTCHA, Cloudflare, login Gov.br e mudanças de layout dos portais.
// Do nosso lado sobra só: classificar o "code" (re-tentar ou não) e baixar o PDF.
//
// ⚠️ Tabela de códigos 6xx resumida; confira a tabela oficial no painel da Infosimples.
const CODIGOS_PERMANENTES = new Set([
  601, // token inválido
  602, // serviço inexistente
  603, // token sem permissão para o serviço
  606, // parâmetro obrigatório ausente
  607, // parâmetro inválido
  608, // parâmetro rejeitado pela fonte
  618, // limite de uso do contrato
]);
const CODIGOS_SEM_DADOS = new Set([612]); // a fonte respondeu, mas não há certidão/dado para o CNPJ

class InfosimplesClient {
  constructor({ infosimplesToken, infosimplesUrl, timeoutFonteSeg, timeoutMs }, { http = axios } = {}) {
    this.token = infosimplesToken;
    this.baseUrl = infosimplesUrl.replace(/\/$/, '');
    this.timeoutFonteSeg = timeoutFonteSeg;
    this.timeoutMs = timeoutMs;
    this.http = http;
  }

  async consultar(servico, parametros) {
    if (!this.token) throw new PermanentError('INFOSIMPLES_TOKEN não configurado', { code: 'BROKER_SEM_TOKEN' });
    let data;
    try {
      ({ data } = await this.http.post(
        `${this.baseUrl}/${servico}`,
        { token: this.token, timeout: this.timeoutFonteSeg, ...parametros },
        { timeout: this.timeoutMs },
      ));
    } catch (err) {
      throw fromHttpError(err, `Infosimples ${servico}`);
    }

    const code = Number(data?.code);
    const msg = `Infosimples ${servico} [${code}] ${data?.code_message || ''} ${(data?.errors || []).join('; ')}`.trim();
    if (code === 200) return { code, dados: data.data || [], recibos: data.site_receipts || [], mensagem: data.code_message };
    if (CODIGOS_SEM_DADOS.has(code)) return { code, dados: [], recibos: data.site_receipts || [], mensagem: msg };
    if (CODIGOS_PERMANENTES.has(code)) throw new PermanentError(msg, { code });
    // 600, 605 (timeout), 609, 610, 613, 614, 615, 617... = instabilidade da fonte → backoff
    throw new TransientError(msg, { code });
  }

  // Os recibos (site_receipts) são URLs temporárias; baixamos para guardar no NOSSO S3.
  async baixarPdf(url) {
    try {
      const { data, headers } = await this.http.get(url, { responseType: 'arraybuffer', timeout: 60000 });
      const buf = Buffer.from(data);
      if (buf.subarray(0, 4).toString() === '%PDF') return buf;
      if (/pdf/.test(headers?.['content-type'] || '')) {
        throw new TransientError(`Recibo ${url} declarado PDF mas conteúdo inválido`);
      }
      return null; // recibo HTML — mantemos só a URL de origem
    } catch (err) {
      throw fromHttpError(err, 'Download do recibo do broker');
    }
  }
}

module.exports = { InfosimplesClient, CODIGOS_PERMANENTES, CODIGOS_SEM_DADOS };
