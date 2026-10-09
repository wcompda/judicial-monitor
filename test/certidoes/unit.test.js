const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const forge = require('node-forge');

const { cnpjValido, normalizarCnpj } = require('../../src/certidoes/core/cnpj');
const { computeBackoff, withRetry } = require('../../src/certidoes/core/backoff');
const { TransientError, PermanentError, fromHttpError } = require('../../src/certidoes/core/errors');
const { toIso } = require('../../src/certidoes/core/datas');
const { classificarSituacao } = require('../../src/certidoes/adapters/base');
const { SerproCndAdapter } = require('../../src/certidoes/federal/serproCndAdapter');
const { CertificadoVault } = require('../../src/certidoes/certificados/certificadoVault');
const { InfosimplesClient } = require('../../src/certidoes/broker/infosimplesClient');
const { BrokerAdapter } = require('../../src/certidoes/broker/brokerAdapter');
const { resolverServico } = require('../../src/certidoes/broker/catalogo');
const { analisar, tiposParaEmitir } = require('../../src/certidoes/raioX/analisador');
const { ComFallback } = require('../../src/certidoes/adapters/registry');

const PDF = Buffer.from('%PDF-1.4\n%fake\n');
const CNPJ = '11222333000181';

// ── Núcleo ────────────────────────────────────────────────────────────────────

test('CNPJ: valida dígitos verificadores', () => {
  assert.ok(cnpjValido('11.222.333/0001-81'));
  assert.ok(!cnpjValido('11.222.333/0001-82'));
  assert.ok(!cnpjValido('11111111111111'));
  assert.throws(() => normalizarCnpj('123'), PermanentError);
});

test('backoff: cresce exponencialmente e respeita o teto', () => {
  const cfg = { baseDelayMs: 1000, maxDelayMs: 10000 };
  assert.strictEqual(computeBackoff(1, cfg, () => 1), 1000);
  assert.strictEqual(computeBackoff(3, cfg, () => 1), 4000);
  assert.strictEqual(computeBackoff(10, cfg, () => 1), 10000);
  assert.strictEqual(computeBackoff(10, cfg, () => 0), 500); // piso = base/2
});

test('withRetry: re-tenta transitório, não re-tenta permanente', async () => {
  let n = 0;
  const r = await withRetry(async () => { if (++n < 3) throw new TransientError('x'); return 'ok'; }, { baseDelayMs: 1, maxDelayMs: 2 });
  assert.strictEqual(r, 'ok');
  n = 0;
  await assert.rejects(withRetry(async () => { n++; throw new PermanentError('y'); }, { baseDelayMs: 1 }), PermanentError);
  assert.strictEqual(n, 1);
});

test('fromHttpError: 5xx/429/rede = transitório; 4xx = permanente', () => {
  assert.ok(fromHttpError({ response: { status: 503, headers: {} } }, 't') instanceof TransientError);
  const e429 = fromHttpError({ response: { status: 429, headers: { 'retry-after': '30' } } }, 't');
  assert.ok(e429 instanceof TransientError);
  assert.strictEqual(e429.retryAfterMs, 30000);
  assert.ok(fromHttpError({ code: 'ECONNRESET', message: 'reset' }, 't') instanceof TransientError);
  assert.ok(fromHttpError({ response: { status: 400, headers: {} } }, 't') instanceof PermanentError);
});

test('datas e classificação de situação', () => {
  assert.strictEqual(toIso('31/12/2026'), '2026-12-31T03:00:00.000Z');
  assert.strictEqual(classificarSituacao('Certidão Positiva com Efeitos de Negativa'), 'POSITIVA_COM_EFEITO_NEGATIVA');
  assert.strictEqual(classificarSituacao('Empresa IRREGULAR perante o FGTS'), 'POSITIVA');
  assert.strictEqual(classificarSituacao('Situação: REGULAR'), 'NEGATIVA');
  assert.strictEqual(classificarSituacao('NADA CONSTA'), 'NEGATIVA');
});

// ── Serpro ────────────────────────────────────────────────────────────────────

const serproCfg = {
  produto: 'consulta-cnd', consumerKey: 'k', consumerSecret: 's',
  tokenUrl: 'https://serpro/token', cndUrl: 'https://serpro/cnd',
  tipoContribuintePJ: 1, codigoIdentificacaoPJ: '9001', timeoutMs: 1000,
};

function httpFalso(respostas) {
  const chamadas = [];
  return {
    chamadas,
    async post(url, body, opts) {
      chamadas.push({ url, body, opts });
      const r = respostas.shift();
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

test('Serpro: token OAuth + emissão com PDF em Buffer', async () => {
  const http = httpFalso([
    { data: { access_token: 'AT', expires_in: 3600 } },
    { data: { Status: 1, Mensagem: ['ok'], Certidao: { TipoCertidao: 'Negativa', CodigoControle: 'ABC.123', DataEmissao: '01/10/2026', DataValidade: '30/03/2027', DocumentoPdf: PDF.toString('base64') } } },
  ]);
  const a = new SerproCndAdapter(serproCfg, { http });
  const r = await a.emitir({ cnpj: CNPJ });
  assert.strictEqual(http.chamadas[0].opts.headers.Authorization, `Basic ${Buffer.from('k:s').toString('base64')}`);
  assert.strictEqual(http.chamadas[1].opts.headers.Authorization, 'Bearer AT');
  assert.deepStrictEqual(http.chamadas[1].body, { TipoContribuinte: 1, ContribuinteConsulta: CNPJ, CodigoIdentificacao: '9001', GerarCertidaoPdf: true });
  assert.strictEqual(r.situacao, 'NEGATIVA');
  assert.strictEqual(r.numero, 'ABC.123');
  assert.ok(Buffer.isBuffer(r.pdf) && r.pdf.equals(PDF));
});

test('Serpro: 401 renova o token e repete a chamada uma vez', async () => {
  const e401 = Object.assign(new Error('401'), { response: { status: 401, headers: {} } });
  const http = httpFalso([
    { data: { access_token: 'A1', expires_in: 3600 } },
    e401,
    { data: { access_token: 'A2', expires_in: 3600 } },
    { data: { Status: 2, Mensagem: ['Há pendências'] } },
  ]);
  const r = await new SerproCndAdapter(serproCfg, { http }).emitir({ cnpj: CNPJ });
  assert.strictEqual(http.chamadas[3].opts.headers.Authorization, 'Bearer A2');
  assert.strictEqual(r.situacao, 'POSITIVA');
  assert.strictEqual(r.pdf, null);
});

test('Serpro Integra Contador: exige certificado e usa Role-Type + jwt_token', async () => {
  const cfg = { ...serproCfg, produto: 'integra-contador', integraAuthUrl: 'https://serpro/auth' };
  await assert.rejects(new SerproCndAdapter(cfg, { http: httpFalso([]) }).emitir({ cnpj: CNPJ }), /exige Certificado A1/);

  const { pfx, senha } = gerarPfx();
  const http = httpFalso([
    { data: { access_token: 'AT', jwt_token: 'JWT', expires_in: 3600 } },
    { data: { Status: 1, Certidao: { TipoCertidao: 'Negativa', DocumentoPdf: PDF.toString('base64') } } },
  ]);
  const vault = { obter: async () => ({ pfx, senha }) };
  await new SerproCndAdapter(cfg, { http, vault }).emitir({ cnpj: CNPJ, certificadoId: 7 });
  assert.strictEqual(http.chamadas[0].url, 'https://serpro/auth');
  assert.strictEqual(http.chamadas[0].opts.headers['Role-Type'], 'TERCEIROS');
  assert.ok(http.chamadas[0].opts.httpsAgent.options.pfx, 'mTLS: agent com PFX');
  assert.strictEqual(http.chamadas[1].opts.headers.jwt_token, 'JWT');
});

// ── Cofre de certificados ─────────────────────────────────────────────────────

function gerarPfx({ cnpj = CNPJ, senha = 's3nh@', diasValidade = 365 } = {}) {
  const keys = forge.pki.rsa.generateKeyPair(1024);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 86400000);
  cert.validity.notAfter = new Date(Date.now() + diasValidade * 86400000);
  const attrs = [{ name: 'commonName', value: `EMPRESA TESTE LTDA:${cnpj}` }];
  cert.setSubject(attrs);
  cert.setIssuer([{ name: 'commonName', value: 'AC TESTE' }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], senha, { algorithm: '3des' });
  return { pfx: Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'), senha };
}

test('Vault: importa PFX, cifra em repouso e decifra só em memória', async () => {
  const salvos = [];
  const repoFake = {
    inserirCertificado: async (c) => { salvos.push(c); return { id: 1, titular_cnpj: c.titularCnpj }; },
    buscarCertificado: async () => ({ ...salvos[0], pfx_cifrado: salvos[0].pfxCifrado, senha_cifrada: salvos[0].senhaCifrada, valido_ate: salvos[0].validoAte, titular_cnpj: salvos[0].titularCnpj }),
  };
  const vault = new CertificadoVault({ masterKey: crypto.randomBytes(32).toString('base64') }, { repository: repoFake });
  const { pfx, senha } = gerarPfx();

  const r = await vault.importar(pfx, senha);
  assert.strictEqual(r.titular_cnpj, CNPJ);
  assert.ok(!salvos[0].pfxCifrado.includes(pfx.subarray(0, 32)), 'PFX não pode estar em claro');
  assert.strictEqual(salvos[0].fingerprint.length, 64);

  const dec = await vault.obter(1);
  assert.ok(dec.pfx.equals(pfx));
  assert.strictEqual(dec.senha, senha);
});

test('Vault: recusa senha errada, certificado vencido e chave mestra ausente', async () => {
  const vault = new CertificadoVault({ masterKey: crypto.randomBytes(32).toString('base64') }, { repository: {} });
  const { pfx } = gerarPfx();
  await assert.rejects(vault.importar(pfx, 'errada'), /Senha do certificado incorreta|Certificado inválido/);
  const vencido = gerarPfx({ diasValidade: -1 });
  await assert.rejects(vault.importar(vencido.pfx, vencido.senha), /vencido/);
  assert.throws(() => new CertificadoVault({}).cifrar(Buffer.from('x')), /CERT_MASTER_KEY/);
});

// ── Broker ────────────────────────────────────────────────────────────────────

const brokerCfg = { infosimplesToken: 'T', infosimplesUrl: 'https://broker/consultas', timeoutFonteSeg: 300, timeoutMs: 1000 };

test('Infosimples: 200 ok, 612 sem dados, 601 permanente, 615 transitório', async () => {
  const mk = (code) => new InfosimplesClient(brokerCfg, { http: { post: async () => ({ data: { code, code_message: 'm', data: [{ a: 1 }], site_receipts: [] } }) } });
  assert.strictEqual((await mk(200).consultar('x', {})).dados.length, 1);
  assert.strictEqual((await mk(612).consultar('x', {})).dados.length, 0);
  await assert.rejects(mk(601).consultar('x', {}), PermanentError);
  await assert.rejects(mk(615).consultar('x', {}), TransientError);
});

test('BrokerAdapter municipal: envia CNPJ + IBGE, normaliza JSON e baixa o PDF', async () => {
  let enviado;
  const http = {
    post: async (url, body) => {
      enviado = { url, body };
      return { data: { code: 200, data: [{ situacao: 'Certidão Negativa de Débitos', certidao_codigo: 'M-99', emissao_data: '01/10/2026', validade_data: '30/11/2026' }], site_receipts: ['https://r/recibo.pdf'] } };
    },
    get: async () => ({ data: PDF, headers: { 'content-type': 'application/pdf' } }),
  };
  const a = new BrokerAdapter('municipal', {
    client: new InfosimplesClient(brokerCfg, { http }),
    catalogo: { municipal: {}, municipalUnificado: 'pref/cnd', estadual: {} },
  });
  const r = await a.emitir({ cnpj: CNPJ, municipioIbge: '3550308' });
  assert.strictEqual(enviado.url, 'https://broker/consultas/pref/cnd');
  assert.strictEqual(enviado.body.cnpj, CNPJ);
  assert.strictEqual(enviado.body.ibge, '3550308');
  assert.strictEqual(enviado.body.token, 'T');
  assert.strictEqual(r.situacao, 'NEGATIVA');
  assert.strictEqual(r.numero, 'M-99');
  assert.strictEqual(r.validaAte, '2026-11-30T03:00:00.000Z');
  assert.ok(r.pdf.equals(PDF));
  assert.strictEqual(r.pdfUrlOrigem, 'https://r/recibo.pdf');
});

test('Catálogo: estadual por UF/template, município sem serviço é permanente', () => {
  const cat = { estadual: { SP: 'pge/sp/cnd' }, estadualTemplate: 'sefaz/{uf}/cnd', municipal: {}, municipalUnificado: null };
  assert.strictEqual(resolverServico('estadual', { cnpj: CNPJ, uf: 'sp' }, cat).servico, 'pge/sp/cnd');
  assert.strictEqual(resolverServico('estadual', { cnpj: CNPJ, uf: 'MG' }, cat).servico, 'sefaz/mg/cnd');
  assert.throws(() => resolverServico('municipal', { cnpj: CNPJ, municipioIbge: '3106200' }, cat), /sem serviço/);
});

test('Fallback federal: Serpro instável → broker', async () => {
  const f = new ComFallback(
    { nome: 'serpro', emitir: async () => { throw new TransientError('503'); } },
    { nome: 'broker', emitir: async () => ({ situacao: 'NEGATIVA', raw: {} }) },
  );
  const r = await f.emitir({ cnpj: CNPJ });
  assert.strictEqual(r.situacao, 'NEGATIVA');
  assert.match(r.raw.fallbackDe, /serpro: 503/);
});

// ── Raio X ────────────────────────────────────────────────────────────────────

test('Raio X: nova pendência, regularização, exclusão do Simples e vencimento', () => {
  const agora = new Date('2026-10-09T12:00:00Z');
  const base = { id: 10, cnpj: CNPJ, status: 'EMITIDA' };
  const tipos = (al) => al.map((a) => a.alerta);

  assert.deepStrictEqual(tipos(analisar({ atual: { ...base, tipo: 'fgts', situacao: 'POSITIVA' }, anterior: { situacao: 'NEGATIVA' }, agora })), ['NOVA_PENDENCIA']);
  assert.deepStrictEqual(tipos(analisar({ atual: { ...base, tipo: 'fgts', situacao: 'POSITIVA' }, anterior: { situacao: 'POSITIVA' }, agora })), []);
  assert.deepStrictEqual(tipos(analisar({ atual: { ...base, tipo: 'federal', situacao: 'NEGATIVA' }, anterior: { situacao: 'POSITIVA' }, agora })), ['REGULARIZADA']);
  assert.deepStrictEqual(tipos(analisar({ atual: { ...base, tipo: 'simples', situacao: 'POSITIVA', raw: { extras: { exclusaoSimples: true } } }, anterior: { situacao: 'POSITIVA' }, agora })), ['EXCLUSAO_SIMPLES']);
  assert.deepStrictEqual(tipos(analisar({ atual: { ...base, tipo: 'federal', situacao: 'NEGATIVA', valida_ate: '2026-10-15T00:00:00Z' }, agora })), ['VENCIMENTO_PROXIMO']);
  assert.deepStrictEqual(tipos(analisar({ atual: { ...base, tipo: 'federal', status: 'ERRO', erro: 'x' }, agora })), ['FALHA_EMISSAO']);
});

test('Raio X: pula NEGATIVAS vigentes quando reemitirVigentes=false', () => {
  const agora = new Date('2026-10-09T12:00:00Z');
  const empresa = { tipos: ['federal', 'fgts', 'municipal'] };
  const vig = [
    { tipo: 'federal', situacao: 'NEGATIVA', valida_ate: '2027-03-01T00:00:00Z' },
    { tipo: 'fgts', situacao: 'NEGATIVA', valida_ate: '2026-10-12T00:00:00Z' },
  ];
  assert.deepStrictEqual(tiposParaEmitir(empresa, vig, { reemitirVigentes: false, diasReemissao: 10, agora }), ['fgts', 'municipal']);
  assert.deepStrictEqual(tiposParaEmitir(empresa, vig, { reemitirVigentes: true }), empresa.tipos);
});

test('Vault: converte PFX legado (RC2-40) que o OpenSSL 3 recusa', (t) => {
  const { execFileSync } = require('child_process');
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pfx-'));
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${dir}/k.pem`, '-out', `${dir}/c.pem`,
      '-days', '30', '-subj', `/CN=EMPRESA LEGADA LTDA:${CNPJ}`], { stdio: 'ignore' });
    execFileSync('openssl', ['pkcs12', '-export', '-legacy', '-inkey', `${dir}/k.pem`, '-in', `${dir}/c.pem`, '-out', `${dir}/l.pfx`,
      '-passout', 'pass:abc123', '-certpbe', 'PBE-SHA1-RC2-40', '-keypbe', 'PBE-SHA1-3DES'], { stdio: 'ignore' });
  } catch {
    t.skip('openssl CLI indisponível');
    return;
  }
  const legado = fs.readFileSync(`${dir}/l.pfx`);
  const novo = CertificadoVault.normalizarPfx(legado, 'abc123');
  assert.ok(!novo.equals(legado));
  assert.strictEqual(CertificadoVault.inspecionar(novo, 'abc123').titularCnpj, CNPJ);
  fs.rmSync(dir, { recursive: true, force: true });
});
