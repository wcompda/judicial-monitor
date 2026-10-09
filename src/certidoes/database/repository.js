const fs = require('fs');
const path = require('path');
const { query } = require('../../database/db');

async function initCertidoesSchema() {
  await query(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
}

// ── Certificados ─────────────────────────────────────────────────────────────

async function inserirCertificado(c) {
  const { rows } = await query(
    `INSERT INTO cert_certificados
       (titular_cnpj, titular_nome, emissor, valido_de, valido_ate, fingerprint_sha256, pfx_cifrado, senha_cifrada)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (fingerprint_sha256) DO UPDATE SET ativo = TRUE, senha_cifrada = EXCLUDED.senha_cifrada
     RETURNING id, titular_cnpj, titular_nome, emissor, valido_de, valido_ate`,
    [c.titularCnpj, c.titularNome, c.emissor, c.validoDe, c.validoAte, c.fingerprint, c.pfxCifrado, c.senhaCifrada],
  );
  return rows[0];
}

async function buscarCertificado(id) {
  const { rows } = await query(`SELECT * FROM cert_certificados WHERE id = $1 AND ativo`, [id]);
  return rows[0] || null;
}

async function listarCertificados() {
  const { rows } = await query(
    `SELECT id, titular_cnpj, titular_nome, emissor, valido_de, valido_ate, created_at
       FROM cert_certificados WHERE ativo ORDER BY valido_ate`,
  );
  return rows;
}

async function certificadosVencendo(dias) {
  const { rows } = await query(
    `SELECT id, titular_cnpj, valido_ate FROM cert_certificados
      WHERE ativo AND valido_ate < NOW() + ($1 || ' days')::interval`, [dias],
  );
  return rows;
}

// ── Empresas ─────────────────────────────────────────────────────────────────

async function upsertEmpresa(e) {
  const { rows } = await query(
    `INSERT INTO cert_empresas (cnpj, razao_social, uf, municipio_ibge, certificado_id, tipos)
     VALUES ($1,$2,$3,$4,$5, COALESCE($6, ARRAY['federal','fgts','trabalhista','estadual','municipal','simples']))
     ON CONFLICT (cnpj) DO UPDATE SET
       razao_social   = COALESCE(EXCLUDED.razao_social, cert_empresas.razao_social),
       uf             = COALESCE(EXCLUDED.uf, cert_empresas.uf),
       municipio_ibge = COALESCE(EXCLUDED.municipio_ibge, cert_empresas.municipio_ibge),
       certificado_id = COALESCE(EXCLUDED.certificado_id, cert_empresas.certificado_id),
       tipos          = COALESCE($6, cert_empresas.tipos),
       ativo          = TRUE,
       updated_at     = NOW()
     RETURNING *`,
    [e.cnpj, e.razaoSocial || null, e.uf || null, e.municipioIbge || null, e.certificadoId || null, e.tipos || null],
  );
  return rows[0];
}

async function buscarEmpresa(cnpj) {
  const { rows } = await query(`SELECT * FROM cert_empresas WHERE cnpj = $1`, [cnpj]);
  return rows[0] || null;
}

async function listarEmpresasAtivas() {
  const { rows } = await query(`SELECT * FROM cert_empresas WHERE ativo ORDER BY id`);
  return rows;
}

// ── Lotes e log de certidões ─────────────────────────────────────────────────

async function criarLote({ id, origem, totalCnpjs }) {
  await query(`INSERT INTO cert_lotes (id, origem, total_cnpjs) VALUES ($1,$2,$3)`, [id, origem, totalCnpjs]);
}

async function finalizarLote(id) {
  // Concluído quando o último CNPJ do lote fechou
  await query(
    `UPDATE cert_lotes l SET status = 'CONCLUIDO', finalizado_em = NOW()
      WHERE l.id = $1 AND l.status <> 'CONCLUIDO'
        AND (SELECT COUNT(DISTINCT cnpj) FROM cert_certidoes c WHERE c.lote_id = l.id) >= l.total_cnpjs`, [id],
  );
}

async function registrarCertidao(r) {
  const { rows } = await query(
    `INSERT INTO cert_certidoes
       (lote_id, cnpj, tipo, status, situacao, numero, pdf_bucket, pdf_key, pdf_sha256, pdf_url_origem,
        emitida_em, valida_ate, fonte, tentativas, erro, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
    [r.loteId || null, r.cnpj, r.tipo, r.status, r.situacao || null, r.numero || null,
      r.pdfBucket || null, r.pdfKey || null, r.pdfSha256 || null, r.pdfUrlOrigem || null,
      r.emitidaEm || null, r.validaAte || null, r.fonte || null, r.tentativas || 1, r.erro || null,
      r.raw ? JSON.stringify(r.raw) : null],
  );
  return rows[0];
}

async function buscarLote(id) {
  const { rows: [lote] } = await query(`SELECT * FROM cert_lotes WHERE id = $1`, [id]);
  if (!lote) return null;
  const { rows: certidoes } = await query(
    `SELECT * FROM cert_certidoes WHERE lote_id = $1 ORDER BY cnpj, tipo`, [id],
  );
  return { ...lote, certidoes };
}

// Última certidão EMITIDA de cada tipo ANTERIOR a um id (base de comparação do Raio X)
async function certidoesAnteriores(cnpj, antesDeId) {
  const { rows } = await query(
    `SELECT DISTINCT ON (tipo) * FROM cert_certidoes
      WHERE cnpj = $1 AND status = 'EMITIDA' AND id < $2
      ORDER BY tipo, id DESC`, [cnpj, antesDeId],
  );
  return Object.fromEntries(rows.map((r) => [r.tipo, r]));
}

async function certidoesDoLote(loteId, cnpj) {
  const { rows } = await query(
    `SELECT * FROM cert_certidoes WHERE lote_id = $1 AND cnpj = $2 ORDER BY id`, [loteId, cnpj],
  );
  return rows;
}

// Última certidão emitida de cada tipo (o Raio X decide o que re-emitir e o que está vencendo)
async function vigentes(cnpj) {
  const { rows } = await query(
    `SELECT DISTINCT ON (tipo) id, tipo, situacao, valida_ate FROM cert_certidoes
      WHERE cnpj = $1 AND status = 'EMITIDA'
      ORDER BY tipo, id DESC`, [cnpj],
  );
  return rows;
}

// ── Alertas (Raio X) ─────────────────────────────────────────────────────────

async function inserirAlerta(a) {
  const { rows } = await query(
    `INSERT INTO cert_alertas (cnpj, tipo, alerta, severidade, detalhe, certidao_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT DO NOTHING RETURNING *`,
    [a.cnpj, a.tipo, a.alerta, a.severidade || 'media', a.detalhe || null, a.certidaoId || null],
  );
  return rows[0] || null; // null = já alertado hoje
}

async function listarAlertas({ apenasAbertos = true, limite = 200 } = {}) {
  const { rows } = await query(
    `SELECT a.*, e.razao_social FROM cert_alertas a LEFT JOIN cert_empresas e ON e.cnpj = a.cnpj
      WHERE ($1 = FALSE OR NOT a.lido) ORDER BY a.created_at DESC LIMIT $2`, [apenasAbertos, limite],
  );
  return rows;
}

async function marcarAlertaLido(id) {
  await query(`UPDATE cert_alertas SET lido = TRUE WHERE id = $1`, [id]);
}

module.exports = {
  initCertidoesSchema,
  inserirCertificado, buscarCertificado, listarCertificados, certificadosVencendo,
  upsertEmpresa, buscarEmpresa, listarEmpresasAtivas,
  criarLote, finalizarLote, registrarCertidao, buscarLote, certidoesAnteriores, certidoesDoLote, vigentes,
  inserirAlerta, listarAlertas, marcarAlertaLido,
};
