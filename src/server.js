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
app.use(express.json({ limit: '15mb' }));
app.use(express.static(require('path').join(__dirname, '../public')));

// ── Auth ────────────────────────────────────────────────────────────────────

function gerarToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function autenticar(req, res, next) {
  const token = req.headers['x-token'] || req.query.token;
  if (!token) return res.status(401).json({ success: false, message: 'Não autorizado' });
  const { rows } = await query(
    `SELECT s.*, u.role, u.pessoas_ids, u.nome as usuario_nome, u.usuario as usuario_login
     FROM sessoes s
     LEFT JOIN usuarios u ON u.id = s.usuario_id
     WHERE s.token = $1 AND s.expires_at > NOW()`, [token]
  );
  if (!rows.length) return res.status(401).json({ success: false, message: 'Sessão inválida ou expirada' });
  const u = rows[0];
  // Sessão legada (sem usuario_id) é sempre admin
  if (!u.usuario_id) u.role = 'admin';
  req.usuario = u;
  next();
}

function isAdmin(req) {
  return req.usuario?.role === 'admin';
}

app.post('/api/login', async (req, res) => {
  try {
    const { usuario, senha } = req.body;

    // Compatibilidade retroativa: se só enviou senha (sem usuario), tenta admin
    if (!usuario) {
      if (senha !== APP_PASSWORD)
        return res.status(401).json({ success: false, message: 'Senha incorreta' });
      const token = gerarToken();
      const { rows: admins } = await query(`SELECT id FROM usuarios WHERE role = 'admin' LIMIT 1`);
      const adminId = admins[0]?.id || null;
      await query(`INSERT INTO sessoes (token, usuario_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`, [token, adminId]);
      return res.json({ success: true, token, role: 'admin' });
    }

    const { rows } = await query(
      `SELECT * FROM usuarios WHERE usuario = $1 AND ativo = 1`, [usuario.toLowerCase().trim()]
    );
    if (!rows.length || rows[0].senha !== senha)
      return res.status(401).json({ success: false, message: 'Usuário ou senha incorretos' });

    const u = rows[0];
    const token = gerarToken();
    await query(`INSERT INTO sessoes (token, usuario_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 days')`, [token, u.id]);
    res.json({ success: true, token, role: u.role, nome: u.nome });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/logout', async (req, res) => {
  const token = req.headers['x-token'];
  if (token) await query(`DELETE FROM sessoes WHERE token = $1`, [token]);
  res.json({ success: true });
});

// ── Usuários (admin only) ────────────────────────────────────────────────────

app.get('/api/usuarios', autenticar, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, message: 'Acesso negado' });
  const { rows } = await query(`SELECT id, nome, usuario, email, role, pessoas_ids, ativo, created_at FROM usuarios ORDER BY id`);
  res.json({ success: true, data: rows });
});

app.post('/api/usuarios', autenticar, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, message: 'Acesso negado' });
  try {
    const { nome, usuario, senha, email, pessoas_ids } = req.body;
    if (!nome || !usuario || !senha) return res.status(400).json({ success: false, message: 'Nome, usuário e senha são obrigatórios' });
    const { rows } = await query(
      `INSERT INTO usuarios (nome, usuario, senha, email, role, pessoas_ids) VALUES ($1, $2, $3, $4, 'viewer', $5) RETURNING id, nome, usuario, email, role, pessoas_ids`,
      [nome, usuario.toLowerCase().trim(), senha, email || null, JSON.stringify(pessoas_ids || [])]
    );
    res.json({ success: true, data: rows[0] });
  } catch (e) {
    res.status(400).json({ success: false, message: 'Nome de usuário já existe' });
  }
});

app.patch('/api/usuarios/:id', autenticar, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, message: 'Acesso negado' });
  try {
    const { senha, pessoas_ids, ativo } = req.body;
    if (senha !== undefined) {
      await query(`UPDATE usuarios SET senha = $1 WHERE id = $2`, [senha, req.params.id]);
    }
    if (pessoas_ids !== undefined) {
      await query(`UPDATE usuarios SET pessoas_ids = $1 WHERE id = $2`, [JSON.stringify(pessoas_ids), req.params.id]);
    }
    if (ativo !== undefined) {
      await query(`UPDATE usuarios SET ativo = $1 WHERE id = $2`, [ativo, req.params.id]);
    }
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.delete('/api/usuarios/:id', autenticar, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ success: false, message: 'Acesso negado' });
  await query(`UPDATE usuarios SET ativo = 0 WHERE id = $1 AND role != 'admin'`, [req.params.id]);
  res.json({ success: true });
});

// ── Auto-cadastro ────────────────────────────────────────────────────────────

app.post('/api/solicitar-cadastro', async (req, res) => {
  try {
    const { nome, email } = req.body;
    if (!nome || !email) return res.status(400).json({ success: false, message: 'Nome e email são obrigatórios' });
    const { rows: existe } = await query(`SELECT id FROM usuarios WHERE email = $1 AND ativo = 1`, [email.toLowerCase().trim()]);
    if (existe.length > 0) return res.status(400).json({ success: false, message: 'Este email já possui cadastro.' });
    const token = require('crypto').randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await query(`INSERT INTO cadastro_tokens (token, nome, email, expires_at) VALUES ($1, $2, $3, $4)`, [token, nome.trim(), email.toLowerCase().trim(), expires]);
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return res.status(500).json({ success: false, message: 'Serviço de email não configurado.' });
    const link = `https://juds.wcom.udi.br/cadastro?token=${token}`;
    // Envia para o admin (único email verificado no Resend free tier)
    // O admin recebe a notificação e encaminha o link para o usuário
    const adminEmail = process.env.EMAIL_TO || 'wcompda@gmail.com';
    const html = `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto"><div style="background:#1e40af;padding:20px;border-radius:12px 12px 0 0;text-align:center"><h2 style="color:white;margin:0">🏛️ JudicialMonitor</h2><p style="color:rgba(255,255,255,.85);margin:6px 0 0">Nova Solicitação de Acesso</p></div><div style="background:white;padding:24px;border-radius:0 0 12px 12px"><p>⚠️ <strong>Ação necessária:</strong> Um novo usuário solicitou acesso ao sistema.</p><table style="width:100%;border-collapse:collapse;margin:16px 0"><tr><td style="padding:8px;background:#f8fafc;border:1px solid #e2e8f0"><strong>Nome:</strong></td><td style="padding:8px;border:1px solid #e2e8f0">${nome}</td></tr><tr><td style="padding:8px;background:#f8fafc;border:1px solid #e2e8f0"><strong>Email:</strong></td><td style="padding:8px;border:1px solid #e2e8f0">${email}</td></tr></table><p>Encaminhe o link abaixo para <strong>${nome}</strong> completar o cadastro:</p><a href="${link}" style="display:block;background:#1e40af;color:white;text-align:center;padding:14px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:16px;margin:20px 0">Link de Cadastro para ${nome}</a><p style="background:#fef3c7;padding:12px;border-radius:6px;font-size:13px;color:#92400e">📋 Ou copie e envie o link: <br><code style="word-break:break-all">${link}</code></p><p style="color:#64748b;font-size:12px">Este link expira em 24 horas.</p></div></div>`;
    const https = require('https');
    const body = JSON.stringify({ from: 'JudicialMonitor <onboarding@resend.dev>', to: [adminEmail], subject: `🏛️ Nova solicitação de acesso: ${nome}`, html });
    await new Promise((resolve, reject) => {
      const r = https.request({ hostname: 'api.resend.com', path: '/emails', method: 'POST', headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => res.statusCode < 300 ? resolve(d) : reject(new Error('Resend ' + res.statusCode + ': ' + d)));
      });
      r.on('error', reject); r.write(body); r.end();
    });
    res.json({ success: true, message: 'Solicitação enviada!', link });
  } catch (e) {
    console.error('[SOLICITAR-CADASTRO]', e.message);
    res.status(500).json({ success: false, message: 'Erro: ' + e.message });
  }
});

app.get('/api/cadastro-token/:token', async (req, res) => {
  const { rows } = await query(`SELECT * FROM cadastro_tokens WHERE token = $1 AND usado = 0 AND expires_at > NOW()`, [req.params.token]);
  if (rows.length === 0) return res.status(404).json({ success: false, message: 'Link inválido ou expirado.' });
  res.json({ success: true, data: { nome: rows[0].nome, email: rows[0].email } });
});

app.post('/api/completar-cadastro', async (req, res) => {
  try {
    const { token, cpf, funcao, senha, usuario } = req.body;
    if (!token || !senha || !usuario) return res.status(400).json({ success: false, message: 'Dados incompletos.' });
    const { rows } = await query(`SELECT * FROM cadastro_tokens WHERE token = $1 AND usado = 0 AND expires_at > NOW()`, [token]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Link inválido ou expirado.' });
    const t = rows[0];
    await query(
      `INSERT INTO usuarios (nome, usuario, senha, email, cpf, funcao, role, pessoas_ids) VALUES ($1, $2, $3, $4, $5, $6, 'viewer', '[]')`,
      [t.nome, usuario.toLowerCase().trim(), senha, t.email, cpf || null, funcao || null]
    );
    await query(`UPDATE cadastro_tokens SET usado = 1 WHERE token = $1`, [token]);
    res.json({ success: true, message: 'Cadastro realizado! Aguarde o administrador liberar seu acesso.' });
  } catch (e) {
    if (e.message.includes('unique')) return res.status(400).json({ success: false, message: 'Este nome de usuário já existe.' });
    res.status(500).json({ success: false, message: 'Erro: ' + e.message });
  }
});

app.post('/api/recuperar-senha', async (req, res) => {
  try {
    const { usuario } = req.body;
    if (!usuario) return res.status(400).json({ success: false, message: 'Informe o usuário' });
    const { rows } = await query(`SELECT id, nome, usuario, email FROM usuarios WHERE usuario = $1 AND ativo = 1`, [usuario.toLowerCase().trim()]);
    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    const u = rows[0];
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!';
    let novaSenha = '';
    for (let i = 0; i < 8; i++) novaSenha += chars[Math.floor(Math.random() * chars.length)];
    await query(`UPDATE usuarios SET senha = $1 WHERE id = $2`, [novaSenha, u.id]);
    const destinatario = u.email || process.env.EMAIL_TO || '';
    if (!destinatario) return res.status(500).json({ success: false, message: 'Nenhum email configurado para este usuário' });
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) return res.status(500).json({ success: false, message: 'Serviço de email não configurado.' });
    const https = require('https');
    const emailHtml = `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto"><div style="background:#1e40af;padding:20px;border-radius:12px 12px 0 0;text-align:center"><h2 style="color:white;margin:0">🔑 Recuperação de Senha</h2><p style="color:rgba(255,255,255,.85);margin:6px 0 0">JudicialMonitor</p></div><div style="background:white;padding:24px;border-radius:0 0 12px 12px"><p>Olá, <strong>${u.nome}</strong>!</p><p>Sua nova senha temporária é:</p><div style="background:#f1f5f9;padding:16px;border-radius:8px;text-align:center;font-size:28px;font-weight:bold;letter-spacing:6px;color:#1e40af;margin:16px 0">${novaSenha}</div><p>Login: <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">${u.usuario}</code></p><p style="color:#64748b;font-size:13px">Por segurança, altere sua senha após o primeiro acesso.</p><a href="https://juds.wcom.udi.br" style="display:block;background:#1e40af;color:white;text-align:center;padding:12px;border-radius:8px;text-decoration:none;font-weight:bold;margin-top:16px">Acessar JudicialMonitor</a></div></div>`;
    const body = JSON.stringify({ from: 'JudicialMonitor <onboarding@resend.dev>', to: [destinatario], subject: '🔑 Recuperação de Senha — JudicialMonitor', html: emailHtml });
    await new Promise((resolve, reject) => {
      const req = https.request({ hostname: 'api.resend.com', path: '/emails', method: 'POST', headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (r) => {
        let d = ''; r.on('data', c => d += c); r.on('end', () => r.statusCode < 300 ? resolve(d) : reject(new Error('Resend erro ' + r.statusCode + ': ' + d)));
      });
      req.on('error', reject); req.write(body); req.end();
    });
    res.json({ success: true, message: 'Senha temporária enviada para seu email!' });
  } catch (e) {
    console.error('[RECUPERAR-SENHA]', e.message);
    res.status(500).json({ success: false, message: 'Erro: ' + e.message });
  }
});

// Retorna dados do usuário logado (role, nome)
app.get('/api/me', autenticar, async (req, res) => {
  res.json({ success: true, data: {
    role: req.usuario?.role || 'admin',
    nome: req.usuario?.usuario_nome || '',
    usuario: req.usuario?.usuario_login || ''
  }});
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
    let whereClause = '';

    // Viewer: filtrar apenas processos das pessoas autorizadas
    if (!isAdmin(req)) {
      const pessoasIds = JSON.parse(req.usuario.pessoas_ids || '[]');
      if (pessoasIds.length === 0) {
        return res.json({ success: true, data: [] });
      }
      // Buscar CPFs das pessoas autorizadas
      const { rows: pessoas } = await query(
        `SELECT cpf FROM pessoas WHERE id = ANY($1::int[])`, [pessoasIds]
      );
      if (pessoas.length === 0) return res.json({ success: true, data: [] });

      const cpfs = pessoas.map(p => p.cpf);
      // Filtrar processos onde alguma das partes tem CPF autorizado
      const cpfConditions = cpfs.map((_, i) => `p.partes ILIKE $${i + 1}`).join(' OR ');
      const { rows } = await query(`
        SELECT p.*,
          (SELECT COUNT(*) FROM movimentacoes m WHERE m.processo_id = p.id) AS total_movs,
          (SELECT COUNT(*) FROM movimentacoes m WHERE m.processo_id = p.id AND m.notificado = 0) AS movs_novas
        FROM processos p
        WHERE ${cpfConditions}
        ORDER BY CASE p.risco WHEN 'vermelho' THEN 1 WHEN 'amarelo' THEN 2 WHEN 'verde' THEN 3 ELSE 4 END, p.updated_at DESC
      `, cpfs.map(c => `%${c}%`));
      return res.json({ success: true, data: rows });
    }

    // Admin: vê tudo
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

app.get('/api/processos/:id/links', autenticar, async (req, res) => {
  try {
    const { rows } = await query(`SELECT numero FROM processos WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Processo não encontrado' });
    const numero = rows[0].numero;
    const cleaned = numero.replace(/\D/g, '');
    if (cleaned.length !== 20) return res.json({ success: true, data: [] });
    const links = [
      { label: 'TJMG (eproc)', url: `https://eproc-consulta-publica-1g.tjmg.jus.br/eproc/externo_controlador.php?acao=processo_consulta_publica&numero_processo=${numero}` },
      { label: 'TJMG (PJe)', url: `https://pje-consulta-publica.tjmg.jus.br/consultapublica/ConsultaPublica/listView.seam?numeroProcesso=${numero}` },
      { label: 'JusBrasil', url: `https://www.jusbrasil.com.br/processos/${numero}` },
      { label: 'Escavador', url: `https://www.escavador.com.br/processo/${numero}` },
    ];
    res.json({ success: true, data: links });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.patch('/api/processos/:id/observacoes', autenticar, async (req, res) => {
  try {
    const { observacoes } = req.body;
    await query(`UPDATE processos SET observacoes = $1 WHERE id = $2`, [observacoes || '', req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.patch('/api/processos/:id/detalhes', autenticar, async (req, res) => {
  try {
    const { classe, assunto, situacao, risco, valor_causa, ultima_movimentacao, partes } = req.body;
    await query(`UPDATE processos SET
      classe = COALESCE($1, classe),
      assunto = COALESCE($2, assunto),
      situacao = COALESCE($3, situacao),
      risco = COALESCE($4, risco),
      valor_causa = COALESCE($5, valor_causa),
      ultima_movimentacao = COALESCE($6, ultima_movimentacao),
      partes = COALESCE($7, partes),
      updated_at = NOW()
      WHERE id = $8`,
      [classe, assunto, situacao, risco, valor_causa, ultima_movimentacao, partes, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/processos/adicionar', autenticar, async (req, res) => {
  try {
    const { numero } = req.body;
    if (!numero) return res.status(400).json({ success: false, message: 'Número obrigatório' });

    const { buscarPorNumero } = require('./services/datajud');
    const resultados = await buscarPorNumero(numero.trim());

    if (resultados.length > 0) {
      const p = resultados[0];
      await query(`
        INSERT INTO processos (id, numero, tribunal, classe, assunto, situacao, risco, ultima_movimentacao, data_distribuicao, partes, valor_causa, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,'azul',$7,$8,$9,$10,NOW())
        ON CONFLICT (id) DO UPDATE SET ultima_movimentacao=$7, situacao=$6, updated_at=NOW()
      `, [p.id, p.numero, p.tribunal, p.classe, p.assunto, p.situacao,
          p.ultima_movimentacao, p.data_distribuicao, p.partes, p.valor_causa]);

      for (const mov of (p.movimentos || [])) {
        const { analyzeRisk } = require('./services/riskAnalyzer');
        const risco = analyzeRisk(mov.nome || mov.descricao || '');
        await query(`
          INSERT INTO movimentacoes (processo_id, data, descricao, risco, notificado)
          VALUES ($1,$2,$3,$4,1) ON CONFLICT DO NOTHING
        `, [p.id, mov.dataHora || mov.data || new Date().toISOString(),
            mov.nome || mov.descricao || 'Registro inicial', risco]);
      }
      return res.json({ success: true, data: p, origem: 'datajud' });
    }

    // Não encontrado no DataJud: salvar número manualmente para monitorar
    const numeroLimpo = numero.trim();
    const partes = req.body.partes || '[{"polo":"ATIVO","nome":"WENRRY JOSE RODRIGUES"}]';
    const tribunal = req.body.tribunal || 'TJMG';
    const id = `manual-${numeroLimpo}`.replace(/[^a-zA-Z0-9-]/g, '-');

    await query(`
      INSERT INTO processos (id, numero, tribunal, classe, assunto, situacao, risco, ultima_movimentacao, data_distribuicao, partes, valor_causa, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,'azul',$7,$8,$9,$10,NOW())
      ON CONFLICT (id) DO NOTHING
    `, [id, numeroLimpo, tribunal, req.body.classe || '', req.body.assunto || 'Adicionado manualmente',
        'Em andamento', new Date().toISOString(), new Date().toISOString(), partes, 0]);

    res.json({ success: true, data: { id, numero: numeroLimpo, tribunal }, origem: 'manual' });
  } catch (e) { res.status(500).json({ success: false, message: e.message }); }
});

app.post('/api/processos/extrair-imagem', autenticar, async (req, res) => {
  try {
    const { imagem, mediaType } = req.body;
    if (!imagem) return res.status(400).json({ success: false, message: 'Imagem obrigatória' });

    const { extrairProcessoDeImagem } = require('./services/extractor');
    const dados = await extrairProcessoDeImagem(imagem, mediaType || 'image/jpeg');

    if (dados.erro) return res.json({ success: false, message: 'Número de processo não encontrado na imagem' });

    res.json({ success: true, data: dados });
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
    let whereClause = '1=1';
    let params = [];

    if (!isAdmin(req)) {
      const pessoasIds = JSON.parse(req.usuario.pessoas_ids || '[]');
      if (pessoasIds.length === 0) {
        return res.json({ success: true, data: { total: 0, vermelhos: 0, amarelos: 0, verdes: 0, azuis: 0, movNovas: 0, ultimaVerif: null } });
      }
      const { rows: pessoas } = await query(`SELECT cpf FROM pessoas WHERE id = ANY($1::int[])`, [pessoasIds]);
      if (pessoas.length === 0) {
        return res.json({ success: true, data: { total: 0, vermelhos: 0, amarelos: 0, verdes: 0, azuis: 0, movNovas: 0, ultimaVerif: null } });
      }
      const cpfs = pessoas.map(p => p.cpf);
      const cpfConditions = cpfs.map((_, i) => `partes ILIKE $${i + 1}`).join(' OR ');
      whereClause = cpfConditions;
      params = cpfs.map(c => `%${c}%`);
    }

    const { rows: [r] } = await query(`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE risco = 'vermelho') as vermelhos,
        COUNT(*) FILTER (WHERE risco = 'amarelo')  as amarelos,
        COUNT(*) FILTER (WHERE risco = 'verde')    as verdes,
        COUNT(*) FILTER (WHERE risco = 'azul')     as azuis
      FROM processos WHERE ${whereClause}
    `, params);
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
