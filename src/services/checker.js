require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { query } = require('../database/db');
const { buscarTodosProcessos, buscarMovimentacoes } = require('./datajud');
const { analyzeRisk } = require('./riskAnalyzer');
const { notificar } = require('./notifications');

async function verificarProcessos() {
  console.log(`\n[CHECKER] Iniciando verificação — ${new Date().toLocaleString('pt-BR')}`);

  let { rows: pessoas } = await query(`SELECT * FROM pessoas WHERE ativo = 1`);
  if (pessoas.length === 0) {
    pessoas = [{ nome: process.env.USER_NAME || 'WENRRY JOSE RODRIGUES', cpf: process.env.USER_CPF || '', email: process.env.EMAIL_TO || '' }];
  }

  let totalProcessos = 0;

  for (const pessoa of pessoas) {
    console.log(`  [PESSOA] Verificando: ${pessoa.nome}`);
    const processos = await buscarTodosProcessos(pessoa.nome);

    for (const p of processos) {
      const { rows } = await query(`SELECT * FROM processos WHERE id = $1`, [p.id]);
      const processoBanco = rows[0];

      if (!processoBanco) {
        await query(`
          INSERT INTO processos (id, numero, tribunal, classe, assunto, situacao, risco, ultima_movimentacao, data_distribuicao, partes, valor_causa, updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,'azul',$7,$8,$9,$10,NOW())
          ON CONFLICT DO NOTHING
        `, [p.id, p.numero, p.tribunal, p.classe, p.assunto, p.situacao,
            p.ultima_movimentacao, p.data_distribuicao, p.partes, p.valor_causa]);

        for (const mov of (p.movimentos || [])) {
          const risco = analyzeRisk(mov.nome || mov.descricao || '');
          await query(`
            INSERT INTO movimentacoes (processo_id, data, descricao, risco, notificado)
            VALUES ($1,$2,$3,$4,1) ON CONFLICT DO NOTHING
          `, [p.id, mov.dataHora || mov.data || new Date().toISOString(),
              mov.nome || mov.descricao || 'Registro inicial', risco]);
        }

        console.log(`  [NOVO] ${p.numero} — ${p.tribunal}`);

      } else {
        const movs = await buscarMovimentacoes(p.numero, p.tribunal.toLowerCase());
        let novas = 0;

        for (const mov of movs) {
          const { rows: existe } = await query(
            `SELECT id FROM movimentacoes WHERE processo_id = $1 AND data = $2 AND descricao = $3`,
            [p.id, mov.data, mov.descricao]
          );
          if (!existe.length) {
            const risco = analyzeRisk(mov.descricao);
            const { rows: [ins] } = await query(`
              INSERT INTO movimentacoes (processo_id, data, descricao, risco, notificado)
              VALUES ($1,$2,$3,$4,0) RETURNING id
            `, [p.id, mov.data, mov.descricao, risco]);
            novas++;

            if (risco === 'vermelho' || risco === 'amarelo') {
              await notificar({ processo: p, movimentacao: mov, risco, pessoa });
              await query(`UPDATE movimentacoes SET notificado = 1 WHERE id = $1`, [ins.id]);
            }
          }
        }

        const { rows: todasMovs } = await query(
          `SELECT descricao FROM movimentacoes WHERE processo_id = $1`, [p.id]
        );
        const novoRisco = analyzeProcessoRisco(todasMovs);
        await query(`UPDATE processos SET risco = $1, updated_at = NOW() WHERE id = $2`, [novoRisco, p.id]);

        if (novas > 0) console.log(`  [UPDATE] ${p.numero} — ${novas} nova(s) movimentação(ões)`);
      }
    }

    totalProcessos += processos.length;
  }

  await query(`UPDATE config SET valor = $1 WHERE chave = 'ultima_verificacao'`, [new Date().toISOString()]);
  console.log(`[CHECKER] Concluído — ${totalProcessos} processo(s) verificado(s) para ${pessoas.length} pessoa(s)\n`);
}

function analyzeProcessoRisco(movs) {
  if (movs.some(m => analyzeRisk(m.descricao) === 'vermelho')) return 'vermelho';
  if (movs.some(m => analyzeRisk(m.descricao) === 'amarelo')) return 'amarelo';
  if (movs.some(m => analyzeRisk(m.descricao) === 'verde')) return 'verde';
  return 'azul';
}

if (require.main === module) {
  verificarProcessos().catch(console.error);
}

module.exports = { verificarProcessos };
