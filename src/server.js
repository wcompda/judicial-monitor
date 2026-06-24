require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const crypto = require('crypto');
const { query, initSchema } = require('./database/db');
const { verificarProcessos } = require('./services/checker');

const app = express();
const PORT = process.env.PORT || 3000;
const INTERVALO_HORAS = parseInt(process.env.INTERVALO_HORAS || '6');
const APP_PASSWORD = process.env.APP_PASSWORD || 'judicial2024';

app.use(cors());
app.use(express.json());
app.use(express.static(require('path').join(__dirname, '../public')));

// ── Auth ────────────────────────────────────────────────────────────────────

function gerarToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function autenticar(req, res, next) {
  const token = req.headers['x-token'] || req.query.token;
  if (!token) return res.status(401).json({ success: false, message: 'Não autorizado' });
  const { rows } = await query(
    `SELECT * FROM sessoes WHERE token = $1 AND expires_at > NOW()`, [token]
  );
  if (!rows.length) return res.status(401).json({ success: false, message: 'Sessão inválida ou expirada' });
  next();
}

app.post('/api/login', async (req, res) => {
  try {
    const { senha } = req.body;
    if (senha !== APP_PASSWORD)
      return res.status(401).json({ success: false, message: 'Senha incorreta' });
    const token = gerarToken();
    await query(`INSERT INTO sessoes (token, expires_at) VALUES ($1, NOW() + INTERVAL '30 days')`, [token]);
    res.json({ success: true, token });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/logout', async (req, res) => {
  const token = req.headers['x-token'];
  if (token) await query(`DELETE FROM sessoes WHERE token = $1`, [token]);
  res.json({ success: true });
});

// ── Pessoas ──────────────────────────────────────────────────────────────────

app.get('/api/pessoas', autenticar, async (req, res) => {
  const { rows } = await query(`SELECT * FROM pessoas WHERE ativo = 1 ORDER BY id`);
  res.json({ success: true, data: rows });
});

app.post('/api/pessoas', autenticar, async (req, res) => {
  try {
    const { nome, cpf, email } = req.body;
    if (!nome || !cpf) return res.status(400).json({ success: false, message: 'Nome e CPF obrigatórios' });
    const cpfLimpo = cpf.replace(/\D/g, '');
    const { rows } = await query(
      `INSERT INTO pessoas (nome, cpf, email) VALUES ($1, $2, $3) RETURNING *`,
      [nome.toUpperCase(), cpfLimpo, email || '']
    );
    res.json({ success: true, data: rows[0] });
  } catch (e) { res.status(400).json({ success: false, message: 'CPF já cadastrado' }); }
});

app.delete('/api/pessoas/:id', autenticar, async (req, res) => {
  await query(`UPDATE pessoas SET ativo = 0 WHERE id = $1`, [req.params.id]);
  res.json({ success: true });
});

// ── Processos ────────────────────────────────────────────────────────────────

app.get('/api/processos', autenticar, async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT p.*,
        (SELECT COUNT(*) FROM movimentacoes m WHERE m.processo_id = p.id) AS total_movs,
        (SELECT COUNT(*) FROM movimentacoes m WHERE m.processo_id = p.id AND m.notificado = 0) AS movs_novas
      FROM processos p
      ORDER BY
        CASE p.risco WHEN 'vermelho' THEN 1 WHEN 'amarelo' THEN 2 WHEN 'verde' THEN 3 ELSE 4 END,
        p.updated_at DESC
    `);
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.get('/api/processos/:id', autenticar, async (req, res) => {
  try {
    const { rows } = await query(`SELECT * FROM processos WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Processo não encontrado' });
    const processo = rows[0];
    const { rows: movs } = await query(
      `SELECT * FROM movimentacoes WHERE processo_id = $1 ORDER BY data DESC LIMIT 50`,
      [req.params.id]
    );
    try { processo.partes = JSON.parse(processo.partes || '[]'); } catch { processo.partes = []; }
    res.json({ success: true, data: { ...processo, movimentacoes: movs } });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/processos/:id', autenticar, async (req, res) => {
  await query(`DELETE FROM movimentacoes WHERE processo_id = $1`, [req.params.id]);
  await query(`DELETE FROM processos WHERE id = $1`, [req.params.id]);
  res.json({ success: true });
});

// ── Estatísticas ─────────────────────────────────────────────────────────────

app.get('/api/stats', autenticar, async (req, res) => {
  try {
    const { rows: [r] } = await query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE risco = 'vermelho') as vermelhos,
        COUNT(*) FILTER (WHERE risco = 'amarelo')  as amarelos,
        COUNT(*) FILTER (WHERE risco = 'verde')    as verdes,
        COUNT(*) FILTER (WHERE risco = 'azul')     as azuis
      FROM processos
    `);
    const { rows: [m] } = await query(`SELECT COUNT(*) as n FROM movimentacoes WHERE notificado = 0`);
    const { rows: [c] } = await query(`SELECT valor FROM config WHERE chave = 'ultima_verificacao'`);
    res.json({ success: true, data: {
      total: parseInt(r.total),
      vermelhos: parseInt(r.vermelhos),
      amarelos:  parseInt(r.amarelos),
      verdes:    parseInt(r.verdes),
      azuis:     parseInt(r.azuis),
      movNovas:  parseInt(m.n),
      ultimaVerif: c?.valor
    }});
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

// ── Verificação manual ───────────────────────────────────────────────────────

app.post('/api/verificar', autenticar, async (req, res) => {
  res.json({ success: true, message: 'Verificação iniciada em background' });
  verificarProcessos().catch(console.error);
});

// ── Marcar como lido ─────────────────────────────────────────────────────────

app.post('/api/processos/:id/lido', autenticar, async (req, res) => {
  await query(`UPDATE movimentacoes SET notificado = 1 WHERE processo_id = $1`, [req.params.id]);
  res.json({ success: true });
});

// ── Health ───────────────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({ success: true, timestamp: new Date().toISOString(), version: '2.0.0', db: 'postgresql' });
});

// ── SPA fallback ─────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../public/index.html'));
});

// ── Start ────────────────────────────────────────────────────────────────────

async function start() {
  await initSchema();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🏛️  JudicialMonitor Backend rodando na porta ${PORT}`);
    console.log(`🐘 Banco: PostgreSQL (dados permanentes)`);
    console.log(`👤 Monitorando: ${process.env.USER_NAME || 'WENRRY JOSE RODRIGUES'}`);
    console.log(`⏰ Verificação automática a cada ${INTERVALO_HORAS}h\n`);
  });

  cron.schedule(`0 */${INTERVALO_HORAS} * * *`, () => {
    verificarProcessos().catch(console.error);
  });

  setTimeout(() => verificarProcessos().catch(console.error), 5000);
}

start().catch(err => {
  console.error('Erro ao iniciar:', err);
  process.exit(1);
});
