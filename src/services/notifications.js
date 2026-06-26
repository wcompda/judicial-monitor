const nodemailer = require('nodemailer');
require('dotenv').config();

const RISK_COLORS = {
  vermelho: { bg: '#dc2626', emoji: '🔴', label: 'ATENCAO URGENTE' },
  amarelo:  { bg: '#d97706', emoji: '🟡', label: 'ATENCAO' },
  verde:    { bg: '#16a34a', emoji: '🟢', label: 'FAVORAVEL' },
  azul:     { bg: '#2563eb', emoji: '🔵', label: 'INFORMATIVO' }
};

function createTransporter() {
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD }
  });
}

function buildHtml(processo, movimentacao, risco, nomePessoa) {
  const cor = RISK_COLORS[risco] || RISK_COLORS.azul;
  const aviso = risco === 'vermelho'
    ? '<div style="margin-top:20px;padding:16px;background:#fef2f2;border-left:4px solid #dc2626;border-radius:6px"><strong style="color:#dc2626">ACAO NECESSARIA:</strong><p style="margin:8px 0 0;color:#7f1d1d">Esta movimentacao pode indicar risco de prejuizo. Consulte seu advogado imediatamente.</p></div>'
    : '';
  const logoUrl = process.env.BASE_URL ? process.env.BASE_URL + '/logo.png' : '';
  const logoHtml = logoUrl
    ? '<img src="' + logoUrl + '" alt="Logo" style="height:48px;margin-bottom:10px;display:block;margin-left:auto;margin-right:auto" />'
    : '';
  return '<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">'
    + '<div style="background:' + cor.bg + ';padding:20px;text-align:center;border-radius:12px 12px 0 0">'
    + logoHtml
    + '<h1 style="color:white;margin:0">' + cor.emoji + ' ' + cor.label + '</h1>'
    + '<p style="color:rgba(255,255,255,.9);margin:8px 0 0">JudicialMonitor - ' + nomePessoa + '</p>'
    + '</div>'
    + '<div style="background:white;padding:24px">'
    + '<table style="width:100%;border-collapse:collapse">'
    + '<tr><td style="padding:10px;background:#f9fafb;font-weight:bold;width:140px">Pessoa</td><td style="padding:10px">' + nomePessoa + '</td></tr>'
    + '<tr><td style="padding:10px;font-weight:bold">Processo</td><td style="padding:10px;font-family:monospace">' + processo.numero + '</td></tr>'
    + '<tr><td style="padding:10px;background:#f9fafb;font-weight:bold">Tribunal</td><td style="padding:10px;background:#f9fafb">' + processo.tribunal + '</td></tr>'
    + '<tr><td style="padding:10px;font-weight:bold">Classe</td><td style="padding:10px">' + (processo.classe || '---') + '</td></tr>'
    + '<tr><td style="padding:10px;background:#f9fafb;font-weight:bold">Data</td><td style="padding:10px;background:#f9fafb">' + new Date(movimentacao.data).toLocaleString('pt-BR') + '</td></tr>'
    + '<tr><td style="padding:10px;font-weight:bold">Movimentacao</td><td style="padding:10px">' + movimentacao.descricao + '</td></tr>'
    + '</table>' + aviso + '</div>'
    + '<div style="background:#f9fafb;padding:16px;text-align:center;border-radius:0 0 12px 12px">'
    + (logoUrl ? '<img src="' + logoUrl + '" alt="Logo" style="height:28px;margin-bottom:8px;display:block;margin-left:auto;margin-right:auto" />' : '')
    + '<p style="margin:0;color:#6b7280;font-size:12px">JudicialMonitor - Verificacao automatica a cada 6 horas</p>'
    + '</div></div>';
}

async function sendEmail({ processo, movimentacao, risco, pessoa }) {
  if (!process.env.EMAIL_USER || !process.env.EMAIL_PASSWORD) {
    console.log('[EMAIL] Credenciais nao configuradas');
    return;
  }
  const cor = RISK_COLORS[risco] || RISK_COLORS.azul;
  const nomePessoa = (pessoa && pessoa.nome) ? pessoa.nome : (process.env.USER_NAME || 'WENRRY JOSE RODRIGUES');
  const emailPessoa = (pessoa && pessoa.email) ? pessoa.email : '';
  const emailAdmin = process.env.EMAIL_TO || '';

  const destinatarios = [];
  if (emailPessoa && emailPessoa !== emailAdmin) destinatarios.push(emailPessoa);
  if (emailAdmin) destinatarios.push(emailAdmin);
  if (destinatarios.length === 0) { console.log('[EMAIL] Nenhum destinatario'); return; }

  try {
    const transporter = createTransporter();
    await transporter.sendMail({
      from: '"JudicialMonitor" <' + process.env.EMAIL_USER + '>',
      to: destinatarios.join(', '),
      subject: cor.emoji + ' [' + cor.label + '] ' + nomePessoa + ' - Processo ' + processo.numero + ' - ' + processo.tribunal,
      html: buildHtml(processo, movimentacao, risco, nomePessoa)
    });
    console.log('[EMAIL] Enviado para: ' + destinatarios.join(', '));
  } catch (err) {
    console.error('[EMAIL] Erro:', err.message);
  }
}

async function sendSMS({ processo, movimentacao, risco, pessoa }) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.log('[SMS] Credenciais Twilio nao configuradas');
    return;
  }
  const cor = RISK_COLORS[risco] || RISK_COLORS.azul;
  const nomePessoa = (pessoa && pessoa.nome) ? pessoa.nome : (process.env.USER_NAME || 'WENRRY');
  const msg = cor.emoji + ' JUDICIAL MONITOR\n' + cor.label + '\nPessoa: ' + nomePessoa + '\nProcesso: ' + processo.numero + '\nTribunal: ' + processo.tribunal + '\n' + movimentacao.descricao.substring(0, 80);

  try {
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    const params = { body: msg, to: process.env.SMS_TO };
    if (process.env.TWILIO_MESSAGING_SERVICE_SID) {
      params.messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    } else {
      params.from = process.env.TWILIO_FROM;
    }
    await twilio.messages.create(params);
    console.log('[SMS] Enviado com sucesso');
  } catch (err) {
    console.error('[SMS] Erro:', err.message);
  }
}

async function notificar(dados) {
  await Promise.all([sendEmail(dados), sendSMS(dados)]);
}

module.exports = { notificar, sendEmail, sendSMS };
