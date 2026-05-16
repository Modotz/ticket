// Pengirim notifikasi Telegram via Bot API. Best-effort: tidak pernah
// melempar error ke pemanggil. Butuh TELEGRAM_BOT_TOKEN di .env dan
// chat_id per pengguna (didapat setelah user /start ke bot).

function enabled() {
  return String(process.env.TELEGRAM_ENABLED).toLowerCase() === 'true'
    && !!process.env.TELEGRAM_BOT_TOKEN;
}

async function sendTelegram(chatId, message) {
  try {
    if (!enabled()) return false;
    const id = String(chatId || '').trim();
    if (!id) return false;

    const url = `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: id,
        text: message,
        disable_web_page_preview: true
      }),
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!r.ok) console.warn('[telegram] status', r.status);
    return r.ok;
  } catch (e) {
    console.warn('[telegram] gagal:', e.message);
    return false;
  }
}

module.exports = { sendTelegram };
