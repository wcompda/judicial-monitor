const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { PermanentError } = require('../core/errors');

// Armazenamento dos PDFs em S3 ou compatível (Cloudflare R2, MinIO, Wasabi).
// O bucket deve ser PRIVADO: o front recebe URLs pré-assinadas com TTL curto.
class ObjectStorage {
  constructor(cfg, { client } = {}) {
    this.cfg = cfg;
    this.client = client || new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle,
    });
  }

  // Chave determinística e navegável: certidoes/{cnpj}/{tipo}/{aaaa-mm-dd}_{sha256-8}.pdf
  static montarChave({ cnpj, tipo, pdf, data = new Date() }) {
    const hash = crypto.createHash('sha256').update(pdf).digest('hex');
    return { key: `certidoes/${cnpj}/${tipo}/${data.toISOString().slice(0, 10)}_${hash.slice(0, 8)}.pdf`, sha256: hash };
  }

  async salvarPdf({ cnpj, tipo, pdf, metadados = {} }) {
    if (!this.cfg.bucket) throw new PermanentError('S3_BUCKET não configurado', { code: 'S3_SEM_BUCKET' });
    if (!Buffer.isBuffer(pdf) || pdf.subarray(0, 4).toString() !== '%PDF') {
      throw new PermanentError(`Conteúdo de ${tipo} não é um PDF válido`, { code: 'PDF_INVALIDO' });
    }
    const { key, sha256 } = ObjectStorage.montarChave({ cnpj, tipo, pdf });
    await this.client.send(new PutObjectCommand({
      Bucket: this.cfg.bucket,
      Key: key,
      Body: pdf,
      ContentType: 'application/pdf',
      ServerSideEncryption: this.cfg.endpoint ? undefined : 'AES256',
      // Metadados S3 só aceitam ASCII
      Metadata: Object.fromEntries(Object.entries({ cnpj, tipo, ...metadados })
        .filter(([, v]) => v != null)
        .map(([k, v]) => [k, String(v).normalize('NFD').replace(/[^\x20-\x7E]/g, '')])),
    }));
    return { bucket: this.cfg.bucket, key, sha256, bytes: pdf.length };
  }

  async urlAssinada(key) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }), {
      expiresIn: this.cfg.signedUrlTtlSec,
    });
  }
}

module.exports = { ObjectStorage };
