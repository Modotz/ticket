const nodemailer = require('nodemailer');

let transporter = null;
function getTransport() {
  if (transporter) return transporter;
  if (String(process.env.MAIL_ENABLED).toLowerCase() !== 'true') return null;
  if (!process.env.SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined
  });
  return transporter;
}

// Kirim email — best effort, tidak pernah melempar error ke pemanggil.
function sendMail(to, subject, html) {
  try {
    const tx = getTransport();
    if (!tx || !to) return Promise.resolve(false);
    return tx.sendMail({
      from: process.env.SMTP_FROM || 'Ticket TSJ <no-reply@ticket.local>',
      to, subject, html
    }).then(() => true).catch(e => {
      console.warn('[mailer] gagal kirim:', e.message);
      return false;
    });
  } catch (e) {
    console.warn('[mailer] error:', e.message);
    return Promise.resolve(false);
  }
}

module.exports = { sendMail };
