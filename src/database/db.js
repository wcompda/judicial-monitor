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
      observacoes TEXT DEFAULT '',
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
      usuario_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      usuario TEXT UNIQUE NOT NULL,
      senha TEXT NOT NULL,
      role TEXT DEFAULT 'viewer',
      pessoas_ids TEXT DEFAULT '[]',
      ativo INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Migrations
  await query(`ALTER TABLE processos ADD COLUMN IF NOT EXISTS observacoes TEXT DEFAULT ''`).catch(() => {});
  await query(`ALTER TABLE sessoes ADD COLUMN IF NOT EXISTS usuario_id INTEGER`).catch(() => {});
  await query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS email TEXT`).catch(() => {});
  await query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cpf TEXT`).catch(() => {});
  await query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS funcao TEXT`).catch(() => {});
  await query(`CREATE TABLE IF NOT EXISTS cadastro_tokens (
    token TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    email TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    usado INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(() => {});

  // ── Tabelas V7 Enterprise ────────────────────────────────────────────────
  await query(`CREATE TABLE IF NOT EXISTS tarefas (
    id SERIAL PRIMARY KEY,
    processo_id TEXT REFERENCES processos(id) ON DELETE CASCADE,
    usuario_id INTEGER,
    descricao TEXT NOT NULL,
    vencimento DATE,
    status TEXT DEFAULT 'aberta',
    prioridade TEXT DEFAULT 'media',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(() => {});

  await query(`CREATE TABLE IF NOT EXISTS auditoria (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER,
    usuario_nome TEXT,
    acao TEXT NOT NULL,
    recurso TEXT,
    recurso_id TEXT,
    ip TEXT,
    origem TEXT DEFAULT 'web',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(() => {});

  await query(`CREATE TABLE IF NOT EXISTS alertas_config (
    id SERIAL PRIMARY KEY,
    usuario_id INTEGER,
    nome TEXT NOT NULL,
    condicao_campo TEXT NOT NULL,
    condicao_valor TEXT NOT NULL,
    canal TEXT DEFAULT 'email',
    ativo INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(() => {});

  await query(`CREATE TABLE IF NOT EXISTS documentos (
    id SERIAL PRIMARY KEY,
    processo_id TEXT REFERENCES processos(id) ON DELETE CASCADE,
    tipo TEXT,
    nome TEXT,
    conteudo_ocr TEXT,
    resumo_ia TEXT,
    hash TEXT UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(() => {});

  await query(`CREATE TABLE IF NOT EXISTS webhooks (
    id SERIAL PRIMARY KEY,
    url TEXT NOT NULL,
    eventos TEXT[] DEFAULT '{}',
    ativo INTEGER DEFAULT 1,
    secret TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(() => {});

  // Migrations perfis expandidos
  await query(`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS perfil TEXT DEFAULT 'viewer'`).catch(() => {});

  // Tabela de palavras-chave configuráveis
  await query(`CREATE TABLE IF NOT EXISTS palavras_chave (
    id SERIAL PRIMARY KEY,
    palavra TEXT NOT NULL UNIQUE,
    risco TEXT NOT NULL DEFAULT 'amarelo',
    ativo INTEGER DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`).catch(() => {});

  // Seed — Dicionário Jurídico Mestre WCOM v1
  const dictSeed = [
    // ── CRÍTICA / VERMELHO ──
    ['sisbajud','vermelho'],['bacenjud','vermelho'],['bloqueio judicial','vermelho'],
    ['bloqueio eletrônico','vermelho'],['bloqueio de ativos','vermelho'],
    ['bloqueio de contas','vermelho'],['bloqueio de saldo','vermelho'],
    ['bloqueio parcial','vermelho'],['bloqueio integral','vermelho'],
    ['ordem de bloqueio','vermelho'],['transferência judicial','vermelho'],
    ['penhora online','vermelho'],['penhora de imóvel','vermelho'],
    ['penhora de veículo','vermelho'],['penhora de faturamento','vermelho'],
    ['penhora de salário','vermelho'],['penhora de ações','vermelho'],
    ['penhora de quotas','vermelho'],['penhora de conta','vermelho'],
    ['penhora de bens','vermelho'],['reforço da penhora','vermelho'],
    ['substituição da penhora','vermelho'],['avaliação de bens','vermelho'],
    ['hasta pública','vermelho'],['primeira praça','vermelho'],
    ['segunda praça','vermelho'],['leilão judicial','vermelho'],
    ['edital de leilão','vermelho'],['arrematação','vermelho'],
    ['adjudicação','vermelho'],['carta de arrematação','vermelho'],
    ['registro da arrematação','vermelho'],
    ['infojud','vermelho'],['renajud','vermelho'],
    ['serasajud','vermelho'],['cnib','vermelho'],
    ['pesquisa patrimonial','vermelho'],['localização de bens','vermelho'],
    ['pesquisa bancária','vermelho'],['pesquisa financeira','vermelho'],
    ['trânsito em julgado','vermelho'],
    ['tutela de evidência','vermelho'],
    ['mandado de prisão','vermelho'],['prisão civil','vermelho'],
    ['sequestro de bens','vermelho'],['arresto','vermelho'],
    ['indisponibilidade','vermelho'],['constrição','vermelho'],
    ['fraude à execução','vermelho'],['fraude contra credores','vermelho'],
    ['astreintes','vermelho'],['multa por descumprimento','vermelho'],
    // ── ALTA / AMARELO ──
    ['apelação','amarelo'],['agravo de instrumento','amarelo'],
    ['agravo interno','amarelo'],['agravo regimental','amarelo'],
    ['embargos de declaração','amarelo'],['embargos infringentes','amarelo'],
    ['embargos à execução','amarelo'],['embargos de terceiro','amarelo'],
    ['recurso especial','amarelo'],['recurso extraordinário','amarelo'],
    ['recurso ordinário','amarelo'],['recurso adesivo','amarelo'],
    ['contrarrazões','amarelo'],['inadmissibilidade','amarelo'],
    ['juízo de retratação','amarelo'],
    ['sentença','amarelo'],['acórdão','amarelo'],
    ['decisão interlocutória','amarelo'],['decisão monocrática','amarelo'],
    ['tutela de urgência','amarelo'],['tutela antecipada','amarelo'],
    ['liminar','amarelo'],['revogação da liminar','amarelo'],
    ['concessão da liminar','amarelo'],
    ['audiência inicial','amarelo'],['audiência de conciliação','amarelo'],
    ['audiência de instrução','amarelo'],['audiência una','amarelo'],
    ['audiência virtual','amarelo'],['audiência presencial','amarelo'],
    ['designação de audiência','amarelo'],['redesignação','amarelo'],
    ['citação','amarelo'],['intimação','amarelo'],
    ['prazo fatal','amarelo'],['prazo encerrado','amarelo'],
    ['decurso de prazo','amarelo'],['urgente','amarelo'],
    ['cumprimento da sentença','amarelo'],['cumprimento de sentença','amarelo'],
    ['execução','amarelo'],['liquidação','amarelo'],
    ['expedição de mandado','amarelo'],['mandado','amarelo'],
    ['carta precatória','amarelo'],['carta rogatória','amarelo'],
    ['busca e apreensão','amarelo'],['busca e apreensão deferida','vermelho'],
    ['contestação','amarelo'],['impugnação','amarelo'],
    ['depósito judicial','amarelo'],['depósito recursal','amarelo'],
    ['precatório','amarelo'],['rpv','amarelo'],
    ['inventário','amarelo'],['habilitação de herdeiros','amarelo'],
    ['mandado de segurança','amarelo'],
    ['custas processuais','amarelo'],['honorários sucumbenciais','amarelo'],
    // ── VERDE / FAVORÁVEL ──
    ['desbloqueio','verde'],['levantamento do bloqueio','verde'],
    ['cancelamento da penhora','verde'],['desconstituição da penhora','verde'],
    ['alvará judicial','verde'],['alvará eletrônico','verde'],
    ['expedição de alvará','verde'],['liberação de valores','verde'],
    ['levantamento de valores','verde'],['restituição de valores','verde'],
    ['pagamento ao executado','verde'],['satisfação do crédito','verde'],
    ['quitação','verde'],['acordo homologado','verde'],
    ['acordo','verde'],['conciliação','verde'],['transação','verde'],
    ['arquivamento','verde'],['arquivado','verde'],['baixa definitiva','verde'],
    ['extinção do processo','verde'],['processo extinto','verde'],
    ['procedência','verde'],['provimento','verde'],
    ['habeas corpus concedido','verde'],['absolvição','verde'],
    ['remição','verde'],['devolução de valores','verde'],
    // ── AZUL / INFORMATIVO ──
    // ── ESPÓLIO / HERANÇA ──
    ['espólio','amarelo'],['espolio','amarelo'],['inventário','amarelo'],
    ['arrolamento','amarelo'],['herdeiro','amarelo'],['meação','amarelo'],
    ['partilha','amarelo'],['sucessão','amarelo'],['testamento','amarelo'],
    // ── AZUL / INFORMATIVO ──
    ['distribuição','azul'],['redistribuição','azul'],['autuação','azul'],
    ['conclusão','azul'],['vista','azul'],['remessa','azul'],
    ['retorno','azul'],['juntada','azul'],['petição','azul'],
    ['manifestação','azul'],['certidão','azul'],['ofício','azul'],
    ['digitalização','azul'],['migração','azul'],
    ['movimentação interna','azul'],['atualização cadastral','azul'],
  ];
  for (const [palavra, risco] of dictSeed) {
    await query(`INSERT INTO palavras_chave (palavra, risco) VALUES ($1, $2) ON CONFLICT (palavra) DO NOTHING`, [palavra, risco]).catch(() => {});
  }
  // Seed V2 — Categorias 7-23 (Família, Imobiliário, Bancário, Trabalhista, Criminal, etc.)
  const dictV2 = [
    // CAT 7 — FAMÍLIA E SUCESSÕES
    ['prisão civil','vermelho'],['débito alimentar','vermelho'],['execução de alimentos','vermelho'],
    ['alienação parental','vermelho'],['suspensão do poder familiar','vermelho'],['destituição do poder familiar','vermelho'],
    ['divórcio','amarelo'],['divórcio consensual','amarelo'],['divórcio litigioso','amarelo'],
    ['separação judicial','amarelo'],['dissolução de união estável','amarelo'],
    ['partilha de bens','amarelo'],['sobrepartilha','amarelo'],
    ['inventário judicial','amarelo'],['inventário extrajudicial','amarelo'],
    ['abertura de inventário','amarelo'],['habilitação de herdeiros','amarelo'],
    ['arrolamento','amarelo'],['formal de partilha','amarelo'],['testamento','amarelo'],
    ['alimentos','amarelo'],['pensão alimentícia','amarelo'],['revisional de alimentos','amarelo'],
    ['exoneração de alimentos','amarelo'],['alimentos provisórios','amarelo'],
    ['guarda','amarelo'],['guarda compartilhada','amarelo'],['guarda unilateral','amarelo'],
    ['regulamentação de visitas','amarelo'],['poder familiar','amarelo'],
    ['acordo homologado','verde'],['pacto antenupcial','azul'],
    ['carta de adjudicação','verde'],['sucessão legítima','azul'],
    // CAT 8 — DIREITO IMOBILIÁRIO
    ['reintegração de posse','vermelho'],['imissão na posse','vermelho'],
    ['despejo','vermelho'],['consolidação da propriedade','vermelho'],
    ['manutenção de posse','amarelo'],['interdito proibitório','amarelo'],
    ['usucapião','amarelo'],['desapropriação','amarelo'],
    ['ação renovatória','amarelo'],['ação revisional de aluguel','amarelo'],
    ['hipoteca','amarelo'],['alienação fiduciária','vermelho'],
    ['registro imobiliário','azul'],['averbação','azul'],
    // CAT 9 — BANCÁRIO
    ['busca e apreensão','vermelho'],['capitalização de juros','amarelo'],
    ['juros abusivos','amarelo'],['revisão contratual','amarelo'],
    ['superendividamento','amarelo'],['protesto','vermelho'],
    ['sustação de protesto','verde'],['nota promissória','amarelo'],
    ['cheque','amarelo'],['duplicata','amarelo'],
    ['cédula de crédito bancário','amarelo'],
    // CAT 10 — RECUPERAÇÃO DE CRÉDITO
    ['cobrança judicial','amarelo'],['confissão de dívida','amarelo'],
    ['parcelamento','verde'],['novação','verde'],['prescrição','verde'],
    ['decadência','verde'],
    // CAT 11 — EMPRESARIAL
    ['falência','vermelho'],['recuperação judicial','vermelho'],
    ['recuperação extrajudicial','amarelo'],['plano de recuperação','amarelo'],
    ['assembleia de credores','amarelo'],['habilitação de crédito','amarelo'],
    ['impugnação de crédito','amarelo'],['liquidação','amarelo'],
    ['dissolução societária','amarelo'],['exclusão de sócio','amarelo'],
    ['apuração de haveres','amarelo'],['administrador judicial','azul'],
    // CAT 12 — TRIBUTÁRIO
    ['execução fiscal','vermelho'],['dívida ativa','vermelho'],['cda','vermelho'],
    ['certidão positiva','amarelo'],['certidão negativa','verde'],
    ['parcelamento fiscal','verde'],['compensação tributária','verde'],
    ['repetição de indébito','verde'],['mandado de segurança tributário','amarelo'],
    // CAT 13 — PREVIDENCIÁRIO
    ['indeferimento','vermelho'],['concessão','verde'],
    ['aposentadoria por invalidez','amarelo'],['auxílio-doença','amarelo'],
    ['auxílio-acidente','amarelo'],['salário-maternidade','amarelo'],
    ['pensão por morte','amarelo'],['loas','amarelo'],['bpc','amarelo'],
    ['revisão da vida toda','amarelo'],['perícia médica','amarelo'],
    ['inss','azul'],['carência','azul'],
    // CAT 14 — TRABALHISTA
    ['reclamação trabalhista','amarelo'],['fgts','amarelo'],
    ['horas extras','amarelo'],['insalubridade','amarelo'],
    ['periculosidade','amarelo'],['acidente de trabalho','vermelho'],
    ['reintegração','verde'],['rescisão indireta','amarelo'],
    ['verbas rescisórias','amarelo'],['estabilidade','amarelo'],
    ['aviso prévio','amarelo'],['banco de horas','azul'],
    // CAT 15 — CRIMINAL
    ['prisão preventiva','vermelho'],['prisão temporária','vermelho'],
    ['flagrante','vermelho'],['habeas corpus','amarelo'],
    ['condenação criminal','vermelho'],['denúncia','amarelo'],
    ['pronúncia','vermelho'],['relaxamento da prisão','verde'],
    ['liberdade provisória','verde'],['absolvição','verde'],
    ['livramento condicional','verde'],['progressão de regime','verde'],
    ['inquérito policial','azul'],['queixa-crime','amarelo'],
    // CAT 16-23 — EVENTOS ESPECIAIS
    ['bloqueio sisbajud','vermelho'],['penhora online','vermelho'],
    ['hasta pública','vermelho'],['bem arrematado','vermelho'],
    ['remição','verde'],['adjudicação','vermelho'],
    ['alvará eletrônico','verde'],['liberação de depósito','verde'],
    ['pagamento ao exequente','verde'],['satisfação do crédito','verde'],
    ['processo parado','azul'],['suspenso','azul'],['sobrestado','azul'],
    ['aguardando manifestação','azul'],['aguardando cumprimento','azul'],
    // Prazos
    ['05 dias','amarelo'],['10 dias','amarelo'],['15 dias','amarelo'],
    ['30 dias','amarelo'],['48 horas','vermelho'],['72 horas','vermelho'],
    ['prazo fatal','vermelho'],['imediatamente','vermelho'],
    ['intime-se','amarelo'],['cite-se','amarelo'],['cumpra-se','amarelo'],
    ['manifeste-se','amarelo'],
    // Valores / dinheiro
    ['valor bloqueado','vermelho'],['valor liberado','verde'],
    ['valor da condenação','amarelo'],['honorários advocatícios','amarelo'],
    ['correção monetária','azul'],
  ];
  for (const [palavra, risco] of dictV2) {
    await query(`INSERT INTO palavras_chave (palavra, risco) VALUES ($1, $2) ON CONFLICT (palavra) DO NOTHING`, [palavra, risco]).catch(() => {});
  }
  console.log('[DB] Dicionário jurídico seedado.');

  // Criar ou sincronizar usuário admin
  const adminUser = process.env.ADMIN_USER || 'wenrry';
  const adminPass = process.env.APP_PASSWORD || 'judicial2024';
  const adminEmail = process.env.EMAIL_TO || '';
  await query(
    `INSERT INTO usuarios (nome, usuario, senha, email, role, pessoas_ids)
     VALUES ($1, $2, $3, $4, 'admin', '[]')
     ON CONFLICT (usuario) DO UPDATE SET senha = EXCLUDED.senha, email = COALESCE(EXCLUDED.email, usuarios.email)`,
    [process.env.USER_NAME || 'WENRRY JOSE RODRIGUES', adminUser, adminPass, adminEmail || null]
  );
  console.log(`[DB] Admin sincronizado: ${adminUser}`);

  // Config padrão
  await query(`INSERT INTO config (chave, valor) VALUES ('ultima_verificacao', $1) ON CONFLICT DO NOTHING`, [new Date(0).toISOString()]);
  await query(`INSERT INTO config (chave, valor) VALUES ('intervalo_horas', '6') ON CONFLICT DO NOTHING`);

  // Pessoa padrão
  const userCpf = process.env.USER_CPF || '';
  const { rows } = await query(`SELECT id FROM pessoas WHERE cpf = $1`, [userCpf]);
  if (rows.length === 0 && userCpf) {
    await query(`INSERT INTO pessoas (nome, cpf, email) VALUES ($1, $2, $3)`, [
      process.env.USER_NAME || 'WENRRY JOSE RODRIGUES',
      userCpf,
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
