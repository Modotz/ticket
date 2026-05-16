// Pengirim WhatsApp lewat gateway yang bisa dikonfigurasi (.env).
// Provider didukung: fonnte, meta (WhatsApp Cloud API), generic.
// Best-effort: tidak pernah melempar error ke pemanggil.

function normalizePhone(p) {
  let s = String(p || '').replace(/[^\d]/g, '');
  if (!s) return '';
  if (s.startsWith('0')) s = '62' + s.slice(1);   // 08xx -> 628xx
  if (s.startsWith('620')) s = '62' + s.slice(3);
  return s;
}

function enabled() {
  return String(process.env.WA_ENABLED).toLowerCase() === 'true'
    && !!process.env.WA_TOKEN;
}

async function sendWA(phone, message) {
  try {
    if (!enabled()) return false;
    const to = normalizePhone(phone);
    if (!to) return false;
    const provider = (process.env.WA_PROVIDER || 'fonnte').toLowerCase();
    let url, opts;

    if (provider === 'fonnte') {
      url = process.env.WA_API_URL || 'https://api.fonnte.com/send';
      opts = {
        method: 'POST',
        headers: { Authorization: process.env.WA_TOKEN,
                   'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ target: to, message }).toString()
      };
    } else if (provider === 'meta') {
      // WhatsApp Cloud API: WA_API_URL = https://graph.facebook.com/v19.0/<PHONE_ID>/messages
      url = process.env.WA_API_URL;
      opts = {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.WA_TOKEN}`,
                   'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', to,
          type: 'text', text: { body: message }
        })
      };
    } else { // generic: POST JSON {phone,message}
      url = process.env.WA_API_URL;
      opts = {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.WA_TOKEN}`,
                   'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: to, message })
      };
    }

    if (!url) return false;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    clearTimeout(t);
    if (!r.ok) console.warn('[whatsapp] gateway status', r.status);
    return r.ok;
  } catch (e) {
    console.warn('[whatsapp] gagal:', e.message);
    return false;
  }
}

module.exports = { sendWA, normalizePhone };
