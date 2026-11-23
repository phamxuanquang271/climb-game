const $ = id => document.getElementById(id);
let host = null; // { code, hostKey }
let snap = null;
let es = null;

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Lỗi');
  return j;
}

function show(id) {
  for (const s of ['setup', 'lobby', 'game', 'over']) $(s).classList.toggle('hidden', s !== id);
}

async function setupJoinUrl() {
  let base = location.origin;
  if (/^(localhost|127\.)/.test(location.hostname)) {
    try {
      const info = await (await fetch('/api/info')).json();
      if (info.ips.length) base = 'http://' + info.ips[0] + ':' + info.port;
      $('hint').textContent = 'Học sinh phải dùng cùng mạng Wi-Fi với máy này.';
    } catch {}
  }
  $('joinUrl').textContent = base.replace(/^https?:\/\//, '');
}

function connect() {
  es = new EventSource(`/events?code=${host.code}&role=host&key=${host.hostKey}`);
  es.onmessage = e => { snap = JSON.parse(e.data); update(); };
  es.onerror = () => {};
}

function update() {
  if (!snap) return;
  $('code').textContent = $('code2').textContent = host.code;
  if (snap.state === 'lobby') {
    show('lobby');
    $('cnt').textContent = snap.players.length;
    $('chips').innerHTML = snap.players.slice().sort((a, b) => a.i - b.i).map(p => `<span class="chip">${p.av} ${esc(p.name)}</span>`).join('') || '<span class="muted">Đang chờ học sinh vào...</span>';
    $('start').disabled = snap.players.length === 0;
  } else if (snap.state === 'playing') {
    show('game');
    renderMountain($('mtn'), snap, null);
    $('lb').innerHTML = leaderboardHtml(snap, null, 10);
  } else {
    show('over');
    const top = snap.players.slice(0, 3);
    const cls = ['p1', 'p2', 'p3'];
    // podium order: 2nd, 1st, 3rd
    const order = [1, 0, 2].filter(i => top[i]);
    $('podium').innerHTML = order.map(i => `<div class="${cls[i]}"><div class="av">${top[i].av}</div><b>${esc(top[i].name)}</b><div class="bar">${i + 1}</div><div class="muted">${top[i].pos}/${snap.top}</div></div>`).join('');
  }
}

setInterval(() => {
  if (snap && snap.state === 'playing') $('timer').textContent = fmtTime(snap.endsAt - Date.now());
}, 250);

$('create').onclick = async () => {
  $('err').textContent = '';
  try {
    const r = await post('/api/create', { duration: +$('dur').value, questions: $('qs').value });
    host = { code: r.code, hostKey: r.hostKey };
    sessionStorage.setItem('host', JSON.stringify(host));
    await setupJoinUrl();
    connect();
  } catch (e) { $('err').textContent = e.message; }
};
$('start').onclick = () => post('/api/start', { code: host.code, hostKey: host.hostKey }).catch(e => alert(e.message));
$('end').onclick = () => { if (confirm('Kết thúc trò chơi ngay bây giờ?')) post('/api/end', { code: host.code, hostKey: host.hostKey }); };

// Resume after page reload
try {
  const saved = JSON.parse(sessionStorage.getItem('host') || 'null');
  if (saved) { host = saved; setupJoinUrl(); connect(); }
} catch {}
