require("dotenv").config();
const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD }
});

transporter.sendMail({
  from: process.env.EMAIL_USER,
  to: process.env.EMAIL_TO,
  subject: "JudicialMonitor - Teste de Email",
  html: "<h2>JudicialMonitor funcionando!</h2><p>Ola Wenrry! Seu sistema esta ativo na nuvem e monitorando processos 24h.</p>"
}, (err, info) => {
  if (err) { console.log("ERRO:", err.message); }
  else { console.log("EMAIL ENVIADO! Para:", process.env.EMAIL_TO); }
  process.exit(0);
});
