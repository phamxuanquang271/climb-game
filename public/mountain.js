// Shared helpers: draws the mountain with climbers, formats time.
function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderMountain(el, snap, meId) {
  if (!el._init) {
    el.innerHTML =
      '<svg class="mtn-svg" viewBox="0 0 100 100" preserveAspectRatio="none">' +
      '<defs><linearGradient id="rock" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8d99a8"/><stop offset="1" stop-color="#55677a"/></linearGradient>' +
      '<linearGradient id="grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#6fcf7f"/><stop offset="1" stop-color="#3f9c58"/></linearGradient></defs>' +
      '<polygon points="-18,100 22,42 62,100" fill="#a9b8c7" opacity=".7"/>' +
      '<polygon points="50,100 82,48 118,100" fill="#a9b8c7" opacity=".7"/>' +
      '<polygon points="-4,100 50,7 104,100" fill="url(#rock)"/>' +
      '<polygon points="41,25 50,7 59,25 54,21 50,26 46,21" fill="#fff"/>' +
      '<rect x="0" y="94" width="100" height="6" fill="url(#grass)"/>' +
      '<line x1="50" y1="7" x2="50" y2="0.5" stroke="#5a3b1e" stroke-width=".5" vector-effect="non-scaling-stroke"/>' +
      '<polygon points="50,0.8 56,2.4 50,4" fill="#e74c5b"/></svg>' +
      '<div class="layer"></div>';
    el._init = true;
    el._nodes = new Map();
  }
  const layer = el.querySelector('.layer');
  const players = snap.players;
  const n = Math.max(players.length, 1);
  const size = Math.max(16, Math.min(38, Math.round(260 / Math.sqrt(n * 3 + 4))));
  const seen = new Set();
  for (const p of players) {
    seen.add(p.id);
    let node = el._nodes.get(p.id);
    if (!node) {
      node = document.createElement('div');
      node.className = 'pl';
      node.innerHTML = '<div class="av"></div><div class="fx"></div><div class="nm"></div>';
      layer.appendChild(node);
      el._nodes.set(p.id, node);
    }
    const lanes = Math.max(...players.map(q => q.i)) + 1;
    const offset = lanes <= 1 ? 0 : (p.i / (lanes - 1) - 0.5) * 0.84;
    const t = p.pos / snap.top;
    node.style.left = 50 + offset * 100 * (1 - 0.86 * t) + '%';
    node.style.bottom = 5 + t * 78 + '%';
    node.querySelector('.av').style.fontSize = size + 'px';
    node.querySelector('.av').textContent = p.pos >= snap.top ? '🏆' : p.av;
    node.querySelector('.nm').textContent = p.name;
    node.classList.toggle('me', p.id === meId);
    const frozen = frozenLeft(p, snap) > 0;
    node.classList.toggle('frozen', frozen);
    node.querySelector('.fx').textContent = (p.sh ? '🛡️' : '') + (p.bo ? '⚡' : '') + (frozen ? '❄️' : '');
  }
  // flash an effect on players that were just attacked
  const evs = snap.events || [];
  if (el._lastEv === undefined) el._lastEv = evs.length ? evs[evs.length - 1].id : 0;
  for (const ev of evs) {
    if (ev.id <= el._lastEv) continue;
    el._lastEv = ev.id;
    if (ev.type === 'bomb' || ev.type === 'freeze' || ev.type === 'blocked') {
      const n = el._nodes.get(ev.toId);
      if (n) { n.dataset.hit = ev.type; n.classList.add('hit'); setTimeout(() => n.classList.remove('hit'), 1000); }
    }
  }
  for (const [id, node] of el._nodes) if (!seen.has(id)) { node.remove(); el._nodes.delete(id); }
}

function leaderboardHtml(snap, meId, limit) {
  return snap.players.slice(0, limit || 99).map((p, i) =>
    `<li><span class="rk">${i + 1}</span><span>${p.av}</span><span class="nm">${esc(p.name)}${p.id === meId ? ' (you)' : ''}</span><span class="sc">${Math.round(p.pos / snap.top * 100)}%</span></li>`
  ).join('');
}

// Milliseconds a player is still frozen, based on when the snapshot arrived.
function frozenLeft(p, snap) {
  return Math.max(0, (p.fz || 0) - (Date.now() - (snap._at || Date.now())));
}

function eventText(ev) {
  const e = esc;
  switch (ev.type) {
    case 'bomb': return `💣 ${e(ev.from)} → ${e(ev.to)}`;
    case 'freeze': return `❄️ ${e(ev.from)} → ${e(ev.to)}`;
    case 'shield': return `🛡️ ${e(ev.from)} got a shield`;
    case 'boost': return `⚡ ${e(ev.from)} is boosted`;
    case 'blocked': return `🛡️ ${e(ev.to)} blocked ${e(ev.from)}'s ${ev.kind === 'bomb' ? '💣' : '❄️'}`;
    default: return '';
  }
}

function eventsHtml(snap, limit) {
  const list = (snap.events || []).slice(-(limit || 6)).reverse();
  return list.map(ev => `<li>${eventText(ev)}</li>`).join('') || '<li class="muted">Nothing yet</li>';
}
