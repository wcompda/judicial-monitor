const https = require('https');
const axios = require('axios');
const { PermanentError, fromHttpError } = require('../core/errors');
const { withRetry } = require('../core/backoff');

// OAuth 2.0 client_credentials no gateway do Serpro, com cache de token em memória.
//
//  - 'consulta-cnd'     → POST {tokenUrl} com Basic base64(consumerKey:consumerSecret).
//  - 'integra-contador' → mesmo Basic, em {integraAuthUrl}, com mTLS usando o Certificado A1
//                         (e-CNPJ) e header Role-Type: TERCEIROS. Devolve access_token + jwt_token.
//
// O https.Agent com o PFX é reaproveitado nas chamadas de negócio (o gateway valida o mesmo TLS).
class SerproAuth {
  constructor(cfg, { certificado = null, http = axios } = {}) {
    this.cfg = cfg;
    this.http = http;
    this.certificado = certificado; // { pfx: Buffer, senha: string } decifrado pelo CertificadoVault
    this.token = null;
    this.inflight = null; // evita "thundering herd": N jobs pedindo token ao mesmo tempo
    this.httpsAgent = certificado
      ? new https.Agent({ pfx: certificado.pfx, passphrase: certificado.senha, keepAlive: true })
      : new https.Agent({ keepAlive: true });
  }

  get usaMtls() {
    return this.cfg.produto === 'integra-contador';
  }

  async getHeaders() {
    const t = await this.getToken();
    const h = { Authorization: `Bearer ${t.accessToken}` };
    if (t.jwtToken) h.jwt_token = t.jwtToken;
    return h;
  }

  async getToken() {
    // Renova 60s antes de expirar
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token;
    if (!this.inflight) {
      this.inflight = this.#solicitarToken().finally(() => { this.inflight = null; });
    }
    this.token = await this.inflight;
    return this.token;
  }

  invalidar() {
    this.token = null;
  }

  async #solicitarToken() {
    const { consumerKey, consumerSecret, tokenUrl, integraAuthUrl, timeoutMs } = this.cfg;
    if (!consumerKey || !consumerSecret) {
      throw new PermanentError('SERPRO_CONSUMER_KEY/SERPRO_CONSUMER_SECRET não configurados', { code: 'SERPRO_SEM_CREDENCIAL' });
    }
    if (this.usaMtls && !this.certificado) {
      throw new PermanentError('Integra Contador exige Certificado A1 (cadastre em /api/certidoes/certificados)', { code: 'SERPRO_SEM_CERTIFICADO' });
    }

    const basic = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const headers = { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' };
    if (this.usaMtls) headers['Role-Type'] = 'TERCEIROS';

    return withRetry(async () => {
      try {
        const { data } = await this.http.post(
          this.usaMtls ? integraAuthUrl : tokenUrl,
          'grant_type=client_credentials',
          { headers, httpsAgent: this.httpsAgent, timeout: timeoutMs },
        );
        return {
          accessToken: data.access_token,
          jwtToken: data.jwt_token, // só no Integra Contador
          expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000,
        };
      } catch (err) {
        throw fromHttpError(err, 'Serpro OAuth');
      }
    }, { retries: 2 });
  }
}

module.exports = { SerproAuth };
