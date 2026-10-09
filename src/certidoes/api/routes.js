const express = require('express');
const config = require('../config');
const repo = require('../database/repository');
const { CertificadoVault } = require('../certificados/certificadoVault');
const { ObjectStorage } = require('../storage/objectStorage');
const { TIPOS } = require('../adapters/registry');
const { normalizarCnpj } = require('../core/cnpj');
const { CertidaoError, PermanentError } = require('../core/errors');
const { dispararLote } = require('../queue/dispatcher');
const { FILAS, getQueue } = require('../queue/queues');

const TIPOS_VALIDOS = Object.keys(TIPOS);

// Rotas montadas em /api/certidoes (ver src/server.js). Todas exigem sessão.
function criarRotasCertidoes({ autenticar, isAdmin }) {
  const r = express.Router();
  const vault = new CertificadoVault(config.vault);
  const storage = new ObjectStorage(config.storage);
  const soAdmin = (req, res, next) => (isAdmin(req) ? next() : res.status(403).json({ success: false, message: 'Apenas admin' }));

  const rota = (fn) => async (req, res) => {
    try {
      await fn(req, res);
    } catch (e) {
      const status = e instanceof PermanentError ? 422 : e instanceof CertidaoError ? 502 : 500;
      res.status(status).json({ success: false, code: e.code, message: e.message });
    }
  };

  r.use(autenticar);

  // ── Certificado A1 ───────────────────────────────────────────────────────
  // Body JSON: { pfxBase64, senha }. Resposta NUNCA contém o PFX nem a senha.
  r.post('/certificados', soAdmin, rota(async (req, res) => {
    const { pfxBase64, senha } = req.body || {};
    if (!pfxBase64 || !senha) throw new PermanentError('Informe pfxBase64 e senha');
    const cert = await vault.importar(Buffer.from(pfxBase64, 'base64'), senha);
    res.status(201).json({ success: true, certificado: cert });
  }));

  r.get('/certificados', rota(async (req, res) => {
    res.json({ success: true, certificados: await repo.listarCertificados() });
  }));

  // ── Carteira de empresas ─────────────────────────────────────────────────
  r.post('/empresas', rota(async (req, res) => {
    const empresa = await repo.upsertEmpresa(normalizarEmpresa(req.body));
    res.status(201).json({ success: true, empresa });
  }));

  r.get('/empresas', rota(async (req, res) => {
    res.json({ success: true, empresas: await repo.listarEmpresasAtivas() });
  }));

  // ── Emissão em lote (assíncrona) ─────────────────────────────────────────
  // Body: { empresas: [{ cnpj, uf?, municipioIbge?, certificadoId? }] | cnpjs: [...], tipos?: [...] }
  // Responde 202 na hora; acompanhe em GET /lotes/:id.
  r.post('/lotes', rota(async (req, res) => {
    const { tipos } = req.body || {};
    const entradas = req.body?.empresas || (req.body?.cnpjs || []).map((cnpj) => ({ cnpj }));
    if (!entradas.length) throw new PermanentError('Informe "empresas" ou "cnpjs"');
    if (entradas.length > 5000) throw new PermanentError('Máximo de 5000 CNPJs por lote');
    if (tipos) validarTipos(tipos);

    const itens = [];
    for (const e of entradas) {
      const empresa = await repo.upsertEmpresa(normalizarEmpresa(e));
      itens.push({ cnpj: empresa.cnpj, tipos: tipos || empresa.tipos });
    }
    const lote = await dispararLote(itens, { origem: 'api' });
    res.status(202).json({ success: true, ...lote, acompanhar: `/api/certidoes/lotes/${lote.loteId}` });
  }));

  r.get('/lotes/:id', rota(async (req, res) => {
    const lote = await repo.buscarLote(req.params.id);
    if (!lote) return res.status(404).json({ success: false, message: 'Lote não encontrado' });
    const certidoes = await Promise.all(lote.certidoes.map(async (c) => ({
      ...c,
      raw: undefined,
      pdf_url: c.pdf_key ? await storage.urlAssinada(c.pdf_key) : null,
    })));
    res.json({ success: true, lote: { ...lote, certidoes } });
  }));

  // ── Raio X ───────────────────────────────────────────────────────────────
  r.get('/alertas', rota(async (req, res) => {
    res.json({ success: true, alertas: await repo.listarAlertas({ apenasAbertos: req.query.todos !== '1' }) });
  }));

  r.post('/alertas/:id/lido', rota(async (req, res) => {
    await repo.marcarAlertaLido(req.params.id);
    res.json({ success: true });
  }));

  // Dispara a varredura agora (fora do horário agendado)
  r.post('/raio-x/executar', soAdmin, rota(async (req, res) => {
    const job = await getQueue(FILAS.raioX).add('varredura', {}, { attempts: 1 });
    res.status(202).json({ success: true, jobId: job.id });
  }));

  return r;
}

function normalizarEmpresa(e = {}) {
  const uf = e.uf ? String(e.uf).toUpperCase() : null;
  if (uf && !/^[A-Z]{2}$/.test(uf)) throw new PermanentError(`UF inválida: ${e.uf}`);
  const ibge = e.municipioIbge ? String(e.municipioIbge).replace(/\D/g, '') : null;
  if (ibge && ibge.length !== 7) throw new PermanentError(`Código IBGE deve ter 7 dígitos: ${e.municipioIbge}`);
  if (e.tipos) validarTipos(e.tipos);
  return {
    cnpj: normalizarCnpj(e.cnpj),
    razaoSocial: e.razaoSocial,
    uf,
    municipioIbge: ibge,
    certificadoId: e.certificadoId ? Number(e.certificadoId) : null,
    tipos: e.tipos,
  };
}

function validarTipos(tipos) {
  const invalidos = [].concat(tipos).filter((t) => !TIPOS_VALIDOS.includes(t));
  if (invalidos.length) throw new PermanentError(`Tipos inválidos: ${invalidos.join(', ')} (válidos: ${TIPOS_VALIDOS.join(', ')})`);
}

module.exports = { criarRotasCertidoes, normalizarEmpresa };
