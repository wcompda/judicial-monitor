const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false },
});

async function query(text, params) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

async function initSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS processos (
      id TEXT PRIMARY KEY,
      numero TEXT UNIQUE NOT NULL,
      tribunal TEXT NOT NULL,
      classe TEXT,
      assunto TEXT,
      situacao TEXT,
      risco TEXT DEFAULT 'azul',
      ultima_movimentacao TEXT,
      data_distribuicao TEXT,
      partes TEXT,
      valor_causa NUMERIC,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS movimentacoes (
      id SERIAL PRIMARY KEY,
      processo_id TEXT NOT NULL REFERENCES processos(id),
      data TEXT NOT NULL,
      descricao TEXT NOT NULL,
      tipo TEXT DEFAULT 'normal',
      risco TEXT DEFAULT 'azul',
      notificado INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS config (
      chave TEXT PRIMARY KEY,
      valor TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pessoas (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      cpf TEXT NOT NULL,
      email TEXT,
      ativo INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS sessoes (
      token TEXT PRIMARY KEY,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);

  // Config padrão
  await query(`INSERT INTO config (chave, valor) VALUES ('ultima_verificacao', $1) ON CONFLICT DO NOTHING`, [new Date(0).toISOString()]);
  await query(`INSERT INTO config (chave, valor) VALUES ('intervalo_horas', '6') ON CONFLICT DO NOTHING`);

  // Pessoa padrão
  const { rows } = await query(`SELECT id FROM pessoas WHERE cpf = $1`, ['64648524691']);
  if (rows.length === 0) {
    await query(`INSERT INTO pessoas (nome, cpf, email) VALUES ($1, $2, $3)`, [
      process.env.USER_NAME || 'WENRRY JOSE RODRIGUES',
      '64648524691',
      process.env.EMAIL_TO || ''
    ]);
  }

  // Processos padrão se banco vazio
  const { rows: proc } = await query(`SELECT COUNT(*) as n FROM processos`);
  if (parseInt(proc[0].n) === 0) {
    const ins = `INSERT INTO processos (id, numero, tribunal, classe, assunto, situacao, risco, ultima_movimentacao, data_distribuicao, partes, valor_causa)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT DO NOTHING`;
    const processos = [
      ['tjmg-0442580-88.2011.8.13.0702','0442580-88.2011.8.13.0702','TJMG','Procedimento Comum','Direito Civil - Arquivado definitivamente em 24/02/2026','Arquivado','azul','2026-02-24','2011-08-10','[{"polo":"ATIVO","nome":"WENRRY JOSE RODRIGUES"}]',0],
      ['tjmg-5025240-04.2017.8.13.0702','5025240-04.2017.8.13.0702','TJMG','Procedimento Comum','Direito do Trabalho - Arquivado em 29/11/2019','Arquivado','azul','2019-11-29','2017-05-12','[{"polo":"ATIVO","nome":"WENRRY JOSE RODRIGUES"}]',0],
      ['tjmg-5061452-14.2023.8.13.0702','5061452-14.2023.8.13.0702','TJMG','Procedimento Comum','Direito Civil - Arquivado em 29/04/2026','Arquivado','azul','2026-04-29','2023-11-08','[{"polo":"ATIVO","nome":"WENRRY JOSE RODRIGUES"}]',0],
      ['tjmg-5009135-71.2021.8.13.0035','5009135-71.2021.8.13.0035','TJMG','Procedimento Comum Civel','Seguro - Reclamacao contra Tokio Marine e Bradesco Auto','Em andamento','amarelo','2026-06-01','2021-03-15','[{"polo":"ATIVO","nome":"WENRRY JOSE RODRIGUES"},{"polo":"ATIVO","nome":"WCOMTEC LTDA"},{"polo":"PASSIVO","nome":"TOKIO MARINE SEGURADORA S.A."},{"polo":"PASSIVO","nome":"BRADESCO AUTO/RE COMPANHIA DE SEGUROS"}]',0],
    ];
    for (const p of processos) await query(ins, p);
    console.log('[DB] 4 processos padrão inseridos no PostgreSQL.');
  }

  console.log('[DB] PostgreSQL pronto.');
}

module.exports = { query, initSchema, pool };
