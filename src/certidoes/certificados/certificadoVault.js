const crypto = require('crypto');
const tls = require('tls');
const forge = require('node-forge');
const { PermanentError } = require('../core/errors');
const repo = require('../database/repository');

// Cofre de Certificados Digitais A1 (.pfx / .p12).
//
// Upload:  valida senha → extrai titular/validade → cifra PFX e senha com AES-256-GCM → grava no banco.
// Uso:     decifra só em memória, no momento de montar o https.Agent do mTLS. Nunca grava em disco,
//          nunca loga, nunca vai para o Redis (o job carrega apenas o certificado_id).
//
// A chave mestra (CERT_MASTER_KEY) fica no ambiente/KMS, nunca no banco. Vazamento do dump do
// banco sem a chave = blobs inúteis.
class CertificadoVault {
  constructor({ masterKey }, { repository = repo } = {}) {
    this.repo = repository;
    this.key = masterKey ? Buffer.from(masterKey, 'base64') : null;
    this.cache = new Map(); // id → { pfx, senha, validoAte } (decifrado, só em memória)
  }

  #exigirChave() {
    if (!this.key || this.key.length !== 32) {
      throw new PermanentError('CERT_MASTER_KEY ausente ou inválida (precisa ser 32 bytes em base64)', { code: 'VAULT_SEM_CHAVE' });
    }
  }

  cifrar(buf) {
    this.#exigirChave();
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const ct = Buffer.concat([c.update(buf), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]);
  }

  decifrar(blob) {
    this.#exigirChave();
    const d = crypto.createDecipheriv('aes-256-gcm', this.key, blob.subarray(0, 12));
    d.setAuthTag(blob.subarray(12, 28));
    return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
  }

  // PFX antigos (RC2-40/3DES, comuns em A1 ICP-Brasil) são recusados pelo OpenSSL 3 do Node 18+
  // ("unsupported"). Reempacota com AES-256 via node-forge para o https.Agent do mTLS aceitar.
  static normalizarPfx(pfx, senha) {
    try {
      tls.createSecureContext({ pfx, passphrase: senha });
      return pfx;
    } catch (e) {
      if (!/unsupported/i.test(e.message)) {
        throw new PermanentError(/mac verify|bad decrypt|password/i.test(e.message)
          ? 'Senha do certificado incorreta' : `Certificado inválido: ${e.message}`, { code: 'CERT_INVALIDO' });
      }
    }
    let p12;
    try {
      p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary'))), senha);
    } catch {
      throw new PermanentError('Senha do certificado incorreta', { code: 'CERT_INVALIDO' });
    }
    const chave = (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || [])[0]?.key
      || (p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || [])[0]?.key;
    const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || []).map((b) => b.cert);
    if (!chave || !certs.length) throw new PermanentError('PFX sem chave privada ou certificado', { code: 'CERT_INVALIDO' });
    const novo = Buffer.from(forge.asn1.toDer(forge.pkcs12.toPkcs12Asn1(chave, certs, senha, { algorithm: 'aes256' })).getBytes(), 'binary');
    tls.createSecureContext({ pfx: novo, passphrase: senha });
    return novo;
  }

  // Lê o PFX sem gravar nada: valida senha e extrai metadados do certificado
  static inspecionar(pfx, senha) {
    const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary'))), senha);
    const bags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
    // O certificado do titular é o que não é CA
    const cert = (bags.find((b) => !b.cert.extensions?.some((e) => e.name === 'basicConstraints' && e.cA)) || bags[0])?.cert;
    if (!cert) throw new PermanentError('PFX sem certificado', { code: 'CERT_INVALIDO' });

    const cn = cert.subject.getField('CN')?.value || '';
    // Padrão ICP-Brasil: CN = "RAZAO SOCIAL:12345678000199"; fallback no OID 2.16.76.1.3.3 (CNPJ)
    let cnpj = /:(\d{14})$/.exec(cn)?.[1];
    if (!cnpj) {
      const san = cert.getExtension('subjectAltName');
      const m = san && /\d{14}/.exec(JSON.stringify(san.altNames || []));
      cnpj = m?.[0];
    }
    if (!cnpj) throw new PermanentError('Não é um e-CNPJ ICP-Brasil (CNPJ não encontrado no certificado)', { code: 'CERT_NAO_ECNPJ' });

    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    return {
      titularCnpj: cnpj,
      titularNome: cn.split(':')[0] || null,
      emissor: cert.issuer.getField('CN')?.value || null,
      validoDe: cert.validity.notBefore,
      validoAte: cert.validity.notAfter,
      fingerprint: crypto.createHash('sha256').update(Buffer.from(der, 'binary')).digest('hex'),
    };
  }

  async importar(pfxOriginal, senha) {
    const pfx = CertificadoVault.normalizarPfx(pfxOriginal, senha);
    const meta = CertificadoVault.inspecionar(pfx, senha);
    if (meta.validoAte < new Date()) {
      throw new PermanentError(`Certificado vencido em ${meta.validoAte.toISOString().slice(0, 10)}`, { code: 'CERT_VENCIDO' });
    }
    const salvo = await this.repo.inserirCertificado({
      ...meta,
      pfxCifrado: this.cifrar(pfx),
      senhaCifrada: this.cifrar(Buffer.from(senha, 'utf8')),
    });
    this.cache.delete(salvo.id);
    return salvo;
  }

  // Devolve { pfx, senha } decifrados para montar o https.Agent
  async obter(id) {
    const c = this.cache.get(id);
    if (c && c.validoAte > new Date()) return c;
    const row = await this.repo.buscarCertificado(id);
    if (!row) throw new PermanentError(`Certificado ${id} não encontrado ou inativo`, { code: 'CERT_NAO_ENCONTRADO' });
    if (new Date(row.valido_ate) < new Date()) throw new PermanentError(`Certificado ${id} vencido`, { code: 'CERT_VENCIDO' });
    const item = {
      id,
      pfx: this.decifrar(row.pfx_cifrado),
      senha: this.decifrar(row.senha_cifrada).toString('utf8'),
      validoAte: new Date(row.valido_ate),
      titularCnpj: row.titular_cnpj,
    };
    this.cache.set(id, item);
    return item;
  }
}

module.exports = { CertificadoVault };
