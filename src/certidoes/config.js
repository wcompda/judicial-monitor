require('dotenv').config();

const int = (v, d) => (v === undefined || v === '' ? d : parseInt(v, 10));
const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'sim', 'yes'].includes(String(v).toLowerCase()));

// Toda configuração do emissor de certidões vem do ambiente. Nada de segredo hardcoded.
module.exports = {
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  queuePrefix: process.env.CERTIDOES_QUEUE_PREFIX || 'certidoes',

  // Retry agressivo: 8 tentativas, base 5s, teto 15min (com jitter) ≈ 40min de janela total
  retry: {
    attempts: int(process.env.CERTIDOES_RETRY_ATTEMPTS, 8),
    baseDelayMs: int(process.env.CERTIDOES_RETRY_BASE_MS, 5000),
    maxDelayMs: int(process.env.CERTIDOES_RETRY_MAX_MS, 15 * 60 * 1000),
  },

  // Concorrência por fila (respeite o rate limit do seu contrato Serpro/Broker)
  concurrency: {
    federal: int(process.env.CONCURRENCY_FEDERAL, 10),
    broker: int(process.env.CONCURRENCY_BROKER, 10),
    lote: int(process.env.CONCURRENCY_LOTE, 20),
  },

  // Raio X Fiscal — sob demanda (POST /api/certidoes/raio-x/executar).
  // Sem agendamento automático por padrão; para agendar, defina RAIO_X_CRON (ex: '0 10 * * 1' = seg 10h).
  raioX: {
    cron: process.env.RAIO_X_CRON || '',
    tz: process.env.RAIO_X_TZ || 'America/Sao_Paulo',
    diasAlertaVencimento: int(process.env.RAIO_X_DIAS_ALERTA_VENCIMENTO, 15),
    // true = re-emite todos os tipos a cada varredura (detecta débito novo mesmo com CND vigente; custa mais chamadas)
    // false = pula NEGATIVAS que ainda valem mais que diasReemissao
    reemitirVigentes: bool(process.env.RAIO_X_REEMITIR_VIGENTES, true),
    diasReemissao: int(process.env.RAIO_X_DIAS_REEMISSAO, 10),
    diasAlertaCertificado: int(process.env.RAIO_X_DIAS_ALERTA_CERTIFICADO, 30),
  },

  // Cofre de certificados A1: chave mestra AES-256 (32 bytes em base64).
  // Gere com: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
  vault: {
    masterKey: process.env.CERT_MASTER_KEY,
  },

  serpro: {
    // 'consulta-cnd' (OAuth2 client_credentials) ou 'integra-contador' (OAuth2 + mTLS e-CNPJ)
    produto: process.env.SERPRO_PRODUTO || 'integra-contador',
    consumerKey: process.env.SERPRO_CONSUMER_KEY,
    consumerSecret: process.env.SERPRO_CONSUMER_SECRET,
    tokenUrl: process.env.SERPRO_TOKEN_URL || 'https://gateway.apiserpro.serpro.gov.br/token',
    integraAuthUrl: process.env.SERPRO_INTEGRA_AUTH_URL || 'https://autenticacao.sapi.serpro.gov.br/authenticate',
    cndUrl: process.env.SERPRO_CND_URL || 'https://gateway.apiserpro.serpro.gov.br/consulta-cnd/v1/certidao',
    // Domínios da API Consulta CND — conferir no contrato/documentação do Serpro
    tipoContribuintePJ: int(process.env.SERPRO_CND_TIPO_CONTRIBUINTE_PJ, 1),
    codigoIdentificacaoPJ: process.env.SERPRO_CND_CODIGO_IDENTIFICACAO_PJ || '9001',
    timeoutMs: int(process.env.SERPRO_TIMEOUT_MS, 30000),
  },

  broker: {
    provider: process.env.BROKER_PROVIDER || 'infosimples',
    infosimplesToken: process.env.INFOSIMPLES_TOKEN,
    infosimplesUrl: process.env.INFOSIMPLES_URL || 'https://api.infosimples.com/api/v2/consultas',
    // Timeout que o broker repassa à fonte (s) e o nosso timeout HTTP (ms) — este precisa ser maior
    timeoutFonteSeg: int(process.env.INFOSIMPLES_TIMEOUT_FONTE_SEG, 300),
    timeoutMs: int(process.env.INFOSIMPLES_TIMEOUT_MS, 330000),
  },

  storage: {
    bucket: process.env.S3_BUCKET,
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined, // R2, MinIO, Wasabi...
    forcePathStyle: bool(process.env.S3_FORCE_PATH_STYLE, false),
    signedUrlTtlSec: int(process.env.S3_SIGNED_URL_TTL, 3600),
  },
};
