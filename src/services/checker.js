require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const { query } = require('../database/db');
const { buscarTodosProcessos, buscarMovimentacoes } = require('./datajud');
const { analyzeRisk, analyzeRiskIA } = require('./riskAnalyzer');
const { notificar } = require('./notifications');
const { buscarContratos } = require('./pncp');
const { buscarComunicacoes, normalizarComunicacao, parteConfere } = require('./djen');

async function verificarProcessos() {
  console.log(`\n[CHECKER] Iniciando verificação — ${new Date().toLocaleString('pt-BR')}`);

  let { rows: pessoas } = await query(`SELECT * FROM pessoas WHERE ativo = 1`);
  if (pessoas.length === 0) {
    pessoas = [{ nome: process.env.USER_NAME || 'WENRRY JOSE RODRIGUES', cpf: process.env.USER_CPF || '', email: process.env.EMAIL_TO || '' }];
  }

  let totalProcessos = 0;

  for (const pessoa of pessoas) {
    console.log(`  [PESSOA] Verificando: ${pessoa.nome}`);
    const processos = await buscarTodosProcessos(pessoa.nome, pessoa.cpf);

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
            // Análise IA completa com fallback para palavras-chave
            const ia = await analyzeRiskIA(mov.descricao, p.numero, p.tribunal);
            const risco = ia ? ia.risco : analyzeRisk(mov.descricao);

            // Monta descrição enriquecida com análise IA
            let descricaoFinal = mov.descricao;
            if (ia) {
              const pergs = ia.perguntas || {};
              const flags = [
                pergs.ha_dinheiro_receber   ? '💰 Há dinheiro a receber' : null,
                pergs.ha_dinheiro_bloqueado  ? '🔒 Há dinheiro bloqueado' : null,
                pergs.risco_penhora          ? '⚠️ Risco de penhora' : null,
                pergs.prazo_recurso_correndo ? '⏰ Prazo de recurso correndo' : null,
                pergs.audiencia_marcada      ? '📅 Audiência marcada' : null,
                pergs.risco_leilao           ? '🔨 Risco de leilão' : null,
                pergs.alvara_determinado     ? '✅ Alvará determinado' : null,
                pergs.processo_encerrado     ? '🏁 Processo encerrado' : null,
              ].filter(Boolean);

              const linhas = [
                `\n\n🤖 IA JURÍDICA — ${ia.prioridade || ''} (${ia.prioridade_num || 0}/100) | ${ia.categoria || ''} › ${ia.subcategoria || ''}`,
                ia.estado_processo ? `📊 Estado: ${ia.estado_processo}` : null,
                `📋 ${ia.o_que_aconteceu || ia.resumo || ''}`,
                ia.proximo_passo  ? `⏭️ Próximo: ${ia.proximo_passo}` : null,
                ia.providencia    ? `✅ Providência: ${ia.providencia}` : null,
                ia.valor_detectado ? `💵 Valor: ${ia.valor_detectado}` : null,
                flags.length      ? flags.join(' | ') : null,
                `📈 Risco: ${ia.grau_risco_pct || 0}% | Sucesso: ${ia.grau_sucesso_pct || 0}% | Urgência: ${ia.urgencia_pct || 0}%`,
                (ia.prob_pagamento_pct > 50) ? `💰 ${ia.prob_pagamento_pct}% chance de recebimento` : null,
                (ia.prob_recurso_pct > 50)   ? `⚖️ ${ia.prob_recurso_pct}% chance de recurso` : null,
              ].filter(Boolean);
              descricaoFinal += linhas.join('\n');
            }

            const { rows: [ins] } = await query(`
              INSERT INTO movimentacoes (processo_id, data, descricao, risco, notificado)
              VALUES ($1,$2,$3,$4,0) RETURNING id
            `, [p.id, mov.data, descricaoFinal, risco]);
            novas++;

            if (risco === 'vermelho' || risco === 'amarelo' || risco === 'verde') {
              await notificar({ processo: p, movimentacao: { ...mov, ia }, risco, pessoa });
              await query(`UPDATE movimentacoes SET notificado = 1 WHERE id = $1`, [ins.id]);
            }
          }
        }

        const { rows: todasMovs } = await query(
          `SELECT descricao FROM movimentacoes WHERE processo_id = $1`, [p.id]
        );
        const novoRisco = analyzeProcessoRisco(todasMovs);
        // Atualiza também campos de texto para corrigir encoding corrompido
        await query(`UPDATE processos SET risco = $1, classe = $2, assunto = $3, situacao = $4, updated_at = NOW() WHERE id = $5`,
          [novoRisco, p.classe, p.assunto, p.situacao, p.id]);

        if (novas > 0) console.log(`  [UPDATE] ${p.numero} — ${novas} nova(s) movimentação(ões)`);
      }
    }

    totalProcessos += processos.length;
  }

  // ── Motor DJEN: intimações e publicações por nome da parte ou OAB ───────
  try { totalProcessos += await verificarDJEN(pessoas); }
  catch (e) { console.error('  [DJEN] falhou:', e.message); }

  // ── Motor DataJud por número: atualiza os processos já cadastrados ──────
  try { await atualizarCadastradosPorNumero(pessoas[0]); }
  catch (e) { console.error('  [DATAJUD-NUMERO] falhou:', e.message); }

  // ── Contratos PNCP + Portal da Transparência ────────────────────────────
  const cpf = process.env.USER_CPF || '';
  const cnpj = process.env.USER_CNPJ || '';
  if (cpf || cnpj) {
    console.log(`  [CONTRATOS] Buscando contratos PNCP/Transparência...`);
    const contratos = await buscarContratos(cpf, cnpj);
    for (const c of contratos) {
      await query(`
        INSERT INTO processos (id, numero, tribunal, classe, assunto, situacao, risco, ultima_movimentacao, data_distribuicao, partes, valor_causa, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,'azul',$7,$8,$9,$10,NOW())
        ON CONFLICT (id) DO UPDATE SET ultima_movimentacao=$7, situacao=$6, updated_at=NOW()
      `, [c.id, c.numero, c.tribunal, c.classe, c.assunto, c.situacao,
          c.ultima_movimentacao, c.data_distribuicao, c.partes, c.valor_causa]);
    }
    console.log(`  [CONTRATOS] ${contratos.length} contrato(s) sincronizado(s)`);
    totalProcessos += contratos.length;
  }

  await query(`UPDATE config SET valor = $1 WHERE chave = 'ultima_verificacao'`, [new Date().toISOString()]);
  console.log(`[CHECKER] Concluído — ${totalProcessos} processo(s) verificado(s) para ${pessoas.length} pessoa(s)\n`);
}

const DIAS_AVISO = parseInt(process.env.DIAS_AVISO || '7');
function ehRecente(dataTexto) {
  const t = Date.parse(String(dataTexto || '').slice(0, 10));
  return !isNaN(t) && (Date.now() - t) <= DIAS_AVISO * 86400000;
}

// Lê o Diário de Justiça Eletrônico Nacional para cada pessoa (nome) e, se houver, OAB.
async function verificarDJEN(pessoas) {
  await query(`ALTER TABLE pessoas ADD COLUMN IF NOT EXISTS oab TEXT`).catch(() => {});
  await query(`ALTER TABLE pessoas ADD COLUMN IF NOT EXISTS uf_oab TEXT`).catch(() => {});
  let vistos = 0, novasTotal = 0;

  for (const pessoa of pessoas) {
    const buscas = [];
    if (pessoa.nome) buscas.push({ filtro: { nomeParte: pessoa.nome }, conferirNome: true });
    if (pessoa.oab && pessoa.uf_oab) {
      const inicio = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      buscas.push({ filtro: { numeroOab: String(pessoa.oab).replace(/\D/g, ''), ufOab: String(pessoa.uf_oab).toUpperCase(), dataDisponibilizacaoInicio: inicio }, conferirNome: false });
    }

    for (const b of buscas) {
      let itens = [];
      try { itens = await buscarComunicacoes(b.filtro); }
      catch (e) { console.error(`  [DJEN] erro na busca de ${pessoa.nome}:`, e.message); continue; }
      console.log(`  [DJEN] ${pessoa.nome}: ${itens.length} publicação(ões)`);

      for (const item of itens) {
        if (item.ativo === false || item.status === 'C') continue;
        if (b.conferirNome && !parteConfere(item, pessoa.nome)) continue;
        const c = normalizarComunicacao(item);
        if (!c.numero || !c.tribunal || !c.data) continue;

        let { rows } = await query(`SELECT id FROM processos WHERE id = $1 OR numero = $2 LIMIT 1`, [c.processoId, c.numero]);
        if (!rows.length) {
          await query(`
            INSERT INTO processos (id, numero, tribunal, classe, assunto, situacao, risco, ultima_movimentacao, data_distribuicao, partes, valor_causa, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,'azul',$7,$8,$9,$10,NOW())
            ON CONFLICT DO NOTHING
          `, [c.processoId, c.numero, c.tribunal, c.classe, '', c.tipo, c.data, '', c.partes, 0]);
          ({ rows } = await query(`SELECT id FROM processos WHERE id = $1 OR numero = $2 LIMIT 1`, [c.processoId, c.numero]));
          if (!rows.length) continue;
          console.log(`  [DJEN][NOVO] ${c.numero} — ${c.tribunal}`);
        }
        const processoId = rows[0].id;
        vistos++;

        const { rows: existe } = await query(
          `SELECT id FROM movimentacoes WHERE processo_id = $1 AND descricao LIKE $2 LIMIT 1`,
          [processoId, `%${c.marcador}%`]
        );
        if (existe.length) continue;

        let risco = analyzeRisk(c.textoLimpo);
        if (risco === 'azul' && /intima|cita/i.test(c.tipo)) risco = 'amarelo';
        const recente = ehRecente(c.data);

        const { rows: [ins] } = await query(`
          INSERT INTO movimentacoes (processo_id, data, descricao, tipo, risco, notificado)
          VALUES ($1,$2,$3,'djen',$4,$5) RETURNING id
        `, [processoId, c.data, c.descricao, risco, recente ? 0 : 1]);
        novasTotal++;

        await query(
          `UPDATE processos SET ultima_movimentacao = GREATEST(COALESCE(ultima_movimentacao,''), $1), situacao = $2,
             risco = CASE WHEN $3 = 'vermelho' OR risco = 'vermelho' THEN 'vermelho' WHEN $3 = 'amarelo' OR risco = 'amarelo' THEN 'amarelo' ELSE risco END,
             updated_at = NOW() WHERE id = $4`,
          [c.data, c.tipo, risco, processoId]
        );

        if (recente) {
          try {
            await notificar({ processo: { id: processoId, numero: c.numero, tribunal: c.tribunal, classe: c.classe }, movimentacao: { data: c.data, descricao: c.descricao }, risco, pessoa });
            await query(`UPDATE movimentacoes SET notificado = 1 WHERE id = $1`, [ins.id]);
          } catch (e) { console.error('  [DJEN] aviso falhou:', e.message); }
        }
      }
      await new Promise(r => setTimeout(r, 1500));
    }
  }
  console.log(`  [DJEN] ${novasTotal} publicação(ões) nova(s) gravada(s)`);
  return vistos;
}

// Atualiza pelo número cada processo judicial já cadastrado (não depende da busca por nome).
async function atualizarCadastradosPorNumero(pessoa) {
  const { rows: cadastrados } = await query(`SELECT id, numero, tribunal FROM processos WHERE tribunal ~ '^(TJ|TRT|TRF|TST|STJ|TRE|TSE|STM|TJM)'`);
  let novasTotal = 0;
  for (const p of cadastrados) {
    const numero = String(p.numero || '').replace(/\D/g, '');
    if (numero.length !== 20) continue;
    const movs = await buscarMovimentacoes(numero, String(p.tribunal).toLowerCase());
    for (const mov of movs) {
      if (!mov.data || !mov.descricao) continue;
      const { rows: existe } = await query(
        `SELECT id FROM movimentacoes WHERE processo_id = $1 AND data = $2 AND (descricao = $3 OR LEFT(descricao, 4) = LEFT($3, 4)) LIMIT 1`,
        [p.id, mov.data, mov.descricao]
      );
      if (existe.length) continue;
      const risco = analyzeRisk(mov.descricao);
      const recente = ehRecente(mov.data);
      const { rows: [ins] } = await query(`
        INSERT INTO movimentacoes (processo_id, data, descricao, risco, notificado)
        VALUES ($1,$2,$3,$4,$5) RETURNING id
      `, [p.id, mov.data, mov.descricao, risco, recente ? 0 : 1]);
      novasTotal++;
      if (recente && (risco === 'vermelho' || risco === 'amarelo' || risco === 'verde')) {
        try {
          await notificar({ processo: p, movimentacao: mov, risco, pessoa });
          await query(`UPDATE movimentacoes SET notificado = 1 WHERE id = $1`, [ins.id]);
        } catch (e) { console.error('  [DATAJUD-NUMERO] aviso falhou:', e.message); }
      }
    }
    await new Promise(r => setTimeout(r, 250));
  }
  console.log(`  [DATAJUD-NUMERO] ${cadastrados.length} processo(s) conferido(s), ${novasTotal} andamento(s) novo(s)`);
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
