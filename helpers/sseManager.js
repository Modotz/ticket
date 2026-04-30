// Menyimpan koneksi SSE aktif: Map<userId, Set<res>>
const clients = new Map();

function addClient(userId, res) {
  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);
}

function removeClient(userId, res) {
  const set = clients.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) clients.delete(userId);
}

function pushToUser(userId, payload) {
  const set = clients.get(userId);
  if (!set || set.size === 0) return;
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  set.forEach(res => {
    try { res.write(data); } catch (_) { set.delete(res); }
  });
}

function connectedCount() {
  let total = 0;
  clients.forEach(s => { total += s.size; });
  return total;
}

module.exports = { addClient, removeClient, pushToUser, connectedCount };
