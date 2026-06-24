const { Pool } = require('pg');

const pool = new Pool({
  connectionString: 'postgresql://postgres:EqGxbCwQeyFnBlJwROtkoLEYzNjoENYb@reseau.proxy.rlwy.net:26675/railway',
  ssl: { rejectUnauthorized: false }
});

async function run() {
  // Atualiza processos arquivados
  await pool.query(`UPDATE processos SET
    situacao='Arquivado', risco='azul',
    assunto='Direito Civil - Arquivado definitivamente em 24/02/2026',
    ultima_movimentacao='2026-02-24',
    partes='[{"polo":"ATIVO","nome":"WENRRY JOSE RODRIGUES"}]'
    WHERE numero='0442580-88.2011.8.13.0702'`);

  await pool.query(`UPDATE processos SET
    situacao='Arquivado', risco='azul',
    assunto='Direito do Trabalho - Arquivado em 29/11/2019',
    ultima_movimentacao='2019-11-29',
    partes='[{"polo":"ATIVO","nome":"WENRRY JOSE RODRIGUES"}]'
    WHERE numero='5025240-04.2017.8.13.0702'`);

  await pool.query(`UPDATE processos SET
    situacao='Arquivado', risco='azul',
    assunto='Direito Civil - Arquivado em 29/04/2026',
    ultima_movimentacao='2026-04-29',
    partes='[{"polo":"ATIVO","nome":"WENRRY JOSE RODRIGUES"}]'
    WHERE numero='5061452-14.2023.8.13.0702'`);

  // Atualiza processo ativo com dados reais
  await pool.query(`UPDATE processos SET
    situacao='Em andamento',
    classe='Procedimento Comum Civel',
    assunto='Seguro - Reclamacao contra Tokio Marine e Bradesco Auto',
    risco='amarelo',
    ultima_movimentacao='2026-06-01',
    partes='[{"polo":"ATIVO","nome":"WENRRY JOSE RODRIGUES"},{"polo":"ATIVO","nome":"WCOMTEC LTDA"},{"polo":"PASSIVO","nome":"TOKIO MARINE SEGURADORA S.A."},{"polo":"PASSIVO","nome":"BRADESCO AUTO/RE COMPANHIA DE SEGUROS"}]'
    WHERE numero='5009135-71.2021.8.13.0035'`);

  // Movimentações reais
  const movs = [
    ['tjmg-0442580-88.2011.8.13.0702', '2026-02-24', 'Processo arquivado definitivamente em 24 de fevereiro de 2026', 'azul', 1],
    ['tjmg-5025240-04.2017.8.13.0702', '2019-11-29', 'Processo arquivado em 29 de novembro de 2019', 'azul', 1],
    ['tjmg-5061452-14.2023.8.13.0702', '2026-04-29', 'Processo arquivado em 29 de abril de 2026', 'azul', 1],
    ['tjmg-5009135-71.2021.8.13.0035', '2026-06-01', 'Processo ativo: 1029896-57.2026.8.13.0702/MG - Autores: WENRRY JOSE RODRIGUES e WCOMTEC LTDA - Reus: TOKIO MARINE SEGURADORA S.A. e BRADESCO AUTO/RE COMPANHIA DE SEGUROS', 'amarelo', 0],
  ];

  for (const [pid, data, desc, risco, notif] of movs) {
    await pool.query(
      `INSERT INTO movimentacoes (processo_id,data,descricao,risco,notificado) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [pid, data, desc, risco, notif]
    );
  }

  const { rows } = await pool.query(`SELECT numero, situacao, risco FROM processos ORDER BY numero`);
  console.log('\n✅ Processos atualizados:');
  rows.forEach(r => console.log(` • ${r.numero} | ${r.situacao} | ${r.risco}`));
  await pool.end();
}

run().catch(e => { console.error('ERRO:', e.message); pool.end(); });
