// Perhitungan progres SLA tiket berdasarkan durasi master prioritas.
// Tiket harus punya kolom: created_at, status, resolved_at, sla_value, sla_unit.

// created_at SQLite (UTC, "YYYY-MM-DD HH:MM:SS") → Date yang benar
function parseDbDate(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T') + 'Z');
  return isNaN(d) ? new Date(s) : d;
}

function unitHours(u) { return u === 'jam' ? 1 : u === 'minggu' ? 168 : 24; } // hari = 24

function humanizeMs(ms) {
  ms = Math.abs(ms);
  const m = Math.floor(ms / 60000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d > 0) return `${d} hr${h ? ' ' + h + ' jam' : ''}`;
  if (h > 0) return `${h} jam${mm ? ' ' + mm + ' mnt' : ''}`;
  return `${mm} mnt`;
}

function computeSla(t) {
  const start = parseDbDate(t.created_at);
  let slaMs;

  // Prioritaskan due_date yang sudah di-snapshot saat tiket dibuat,
  // supaya perubahan master prioritas tidak menggeser SLA tiket lama.
  if (t.due_date && start) {
    slaMs = parseDbDate(t.due_date) - start;
  } else if (t.sla_value) {
    slaMs = t.sla_value * unitHours(t.sla_unit) * 3600 * 1000;
  }

  if (!slaMs || slaMs <= 0 || !start) {
    return { state: 'none', pct: 0, color: 'secondary', label: 'SLA belum diatur' };
  }
  const targetLabel = t.sla_value ? `${t.sla_value} ${t.sla_unit}` : humanizeMs(slaMs);
  const finished = ['resolved', 'closed'].includes(t.status) && t.resolved_at;

  if (finished) {
    const used = parseDbDate(t.resolved_at) - start;
    const late = used > slaMs;
    return {
      state: late ? 'done_late' : 'done_ok',
      pct: 100,
      color: late ? 'danger' : 'success',
      label: late ? `Selesai · telat ${humanizeMs(used - slaMs)}` : 'Selesai · tepat waktu',
      target: targetLabel
    };
  }

  const elapsed = Date.now() - start;
  const pctRaw = (elapsed / slaMs) * 100;
  const pct = Math.max(0, Math.min(100, Math.round(pctRaw)));

  if (elapsed >= slaMs) {
    return {
      state: 'breach', pct: 100, color: 'danger',
      label: `Lewat SLA · ${humanizeMs(elapsed - slaMs)}`,
      target: targetLabel
    };
  }
  const remaining = slaMs - elapsed;
  return {
    state: pctRaw >= 75 ? 'warn' : 'ok',
    pct,
    color: pctRaw >= 75 ? 'warning' : 'success',
    label: `Sisa ${humanizeMs(remaining)}`,
    target: targetLabel
  };
}

module.exports = { computeSla };
