const nodemailer = require('nodemailer');
const { dispararWebhooks } = require('../../services/notifications');
const { formatarCnpj } = require('../core/cnpj');

// Notifica alertas novos do Raio X: webhooks cadastrados (evento "certidao_alerta") sempre,
// e e-mail consolidado por CNPJ quando houver alerta de severidade alta.
async function notificarAlertas(cnpj, alertas) {
  if (!alertas.length) return;
  for (const a of alertas) {
    await dispararWebhooks('certidao_alerta', { cnpj, tipo: a.tipo, alerta: a.alerta, severidade: a.severidade, detalhe: a.detalhe });
  }

  const altas = alertas.filter((a) => a.severidade === 'alta');
  if (!altas.length || !process.env.EMAIL_USER || !process.env.EMAIL_TO) return;
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD },
  });
  const linhas = altas.map((a) => `<li><b>${a.alerta}</b> — ${a.tipo}: ${escapar(a.detalhe || '')}</li>`).join('');
  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: process.env.EMAIL_TO,
    subject: `⚠️ Raio X Fiscal: ${altas.length} alerta(s) para ${formatarCnpj(cnpj)}`,
    html: `<p>O Raio X Fiscal encontrou alterações para o CNPJ <b>${formatarCnpj(cnpj)}</b>:</p><ul>${linhas}</ul>`,
  }).catch((e) => console.error('[raio-x] falha ao enviar e-mail:', e.message));
}

const escapar = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

module.exports = { notificarAlertas };
