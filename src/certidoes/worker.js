// Processo separado do servidor web: `npm run worker:certidoes`
// Escala horizontalmente — suba N réplicas; o Redis distribui os jobs e o agendador
// do Raio X garante uma única varredura por dia.
require('dotenv').config();
const { initCertidoesSchema } = require('./database/repository');
const { iniciarWorkers } = require('./queue/workers');
const { agendarRaioX } = require('./raioX/raioXService');
const { fecharFilas } = require('./queue/queues');

async function main() {
  await initCertidoesSchema();
  const workers = iniciarWorkers();
  const { cron, tz } = await agendarRaioX();
  console.log(`📄 Workers de certidões no ar (${workers.map((w) => w.name).join(', ')})`);
  console.log(`🩻 Raio X Fiscal agendado: "${cron}" (${tz})`);

  const desligar = async (sinal) => {
    console.log(`\n${sinal} recebido — finalizando jobs em andamento...`);
    await Promise.allSettled(workers.map((w) => w.close()));
    await fecharFilas();
    process.exit(0);
  };
  process.on('SIGTERM', () => desligar('SIGTERM'));
  process.on('SIGINT', () => desligar('SIGINT'));
}

main().catch((err) => {
  console.error('Erro ao iniciar workers de certidões:', err);
  process.exit(1);
});
