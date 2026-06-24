require('dotenv').config();
const { getDb } = require('./src/database/db');

const db = getDb();

const processos = [
  {
    id: 'tjmg_0442580-88.2011.8.13.0702',
    numero: '0442580-88.2011.8.13.0702',
    tribunal: 'TJMG',
    classe: 'Processo Cível',
    assunto: 'Ação Cível',
    situacao: 'Arquivado definitivamente',
    risco: 'verde',
    ultima_movimentacao: '2026-02-24T00:00:00.000Z',
    data_distribuicao: '2011-01-01T00:00:00.000Z',
    movimentos: [{ data: '2026-02-24T00:00:00.000Z', descricao: 'Processo arquivado definitivamente', risco: 'verde' }]
  },
  {
    id: 'tjmg_5025240-04.2017.8.13.0702',
    numero: '5025240-04.2017.8.13.0702',
    tribunal: 'TJMG',
    classe: 'Processo Cível',
    assunto: 'Ação Cível',
    situacao: 'Arquivado',
    risco: 'verde',
    ultima_movimentacao: '2019-11-29T00:00:00.000Z',
    data_distribuicao: '2017-01-01T00:00:00.000Z',
    movimentos: [{ data: '2019-11-29T00:00:00.000Z', descricao: 'Processo arquivado', risco: 'verde' }]
  },
  {
    id: 'tjmg_5061452-14.2023.8.13.0702',
    numero: '5061452-14.2023.8.13.0702',
    tribunal: 'TJMG',
    classe: 'Processo Cível',
    assunto: 'Ação Cível',
    situacao: 'Arquivado',
    risco: 'verde',
    ultima_movimentacao: '2026-04-29T00:00:00.000Z',
    data_distribuicao: '2023-01-01T00:00:00.000Z',
    movimentos: [{ data: '2026-04-29T00:00:00.000Z', descricao: 'Processo arquivado', risco: 'verde' }]
  },
  {
    id: 'tjmg_5009135-71.2021.8.13.0035',
    numero: '5009135-71.2021.8.13.0035',
    tribunal: 'TJMG',
    classe: 'Processo Cível',
    assunto: 'Ação Cível',
    situacao: 'Em andamento',
    risco: 'amarelo',
    ultima_movimentacao: '2021-01-01T00:00:00.000Z',
    data_distribuicao: '2021-01-01T00:00:00.000Z',
    movimentos: [{ data: '2021-01-01T00:00:00.000Z', descricao: 'Processo em andamento — aguardando consulta completa', risco: 'amarelo' }]
  }
];

const insertProcesso = db.prepare(`
  INSERT OR REPLACE INTO processos
  (id, numero, tribunal, classe, assunto, situacao, risco, ultima_movimentacao, data_distribuicao, partes, valor_causa, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 0, datetime('now'))
`);

const insertMov = db.prepare(`
  INSERT OR IGNORE INTO movimentacoes (processo_id, data, descricao, risco, notificado)
  VALUES (?, ?, ?, ?, 1)
`);

for (const p of processos) {
  insertProcesso.run(p.id, p.numero, p.tribunal, p.classe, p.assunto, p.situacao, p.risco, p.ultima_movimentacao, p.data_distribuicao);
  for (const m of p.movimentos) {
    insertMov.run(p.id, m.data, m.descricao, m.risco);
  }
  console.log(`✓ ${p.numero} — ${p.risco.toUpperCase()}`);
}

console.log('\n4 processos inseridos com sucesso!');
process.exit(0);
