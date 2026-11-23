const $ = id => document.getElementById(id);
const knownChips = new Set();
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
  es.onmessage = e => { snap = JSON.parse(e.data); snap._at = Date.now(); update(); };
  es.onerror = () => {};
}

function update() {
  if (!snap) return;
  teacherSounds();
  $('code').textContent = $('code2').textContent = host.code;
  if (snap.state === 'lobby') {
    show('lobby');
    $('cnt').textContent = snap.players.length;
    $('chips').innerHTML = snap.players.slice().sort((a, b) => a.i - b.i).map(p => {
      const isNew = !knownChips.has(p.id);
      knownChips.add(p.id);
      return `<span class="chip${isNew ? ' pop' : ''}">${p.av} ${esc(p.name)}</span>`;
    }).join('') || '<span class="muted">Đang chờ học sinh vào...</span>';
    $('start').disabled = snap.players.length === 0;
  } else if (snap.state === 'playing') {
    show('game');
    renderMountain($('mtn'), snap, null);
    $('lb').innerHTML = leaderboardHtml(snap, null, 10);
    $('feed').innerHTML = eventsHtml(snap, 6);
  } else {
    show('over');
    const top = snap.players.slice(0, 3);
    const cls = ['p1', 'p2', 'p3'];
    // podium order: 2nd, 1st, 3rd
    const order = [1, 0, 2].filter(i => top[i]);
    $('podium').innerHTML = order.map(i => `<div class="${cls[i]}"><div class="av">${top[i].av}</div><b>${esc(top[i].name)}</b><div class="bar">${i + 1}</div><div class="muted">${Math.round(top[i].pos / snap.top * 100)}%</div></div>`).join('');
  }
}

let lastTick = 0;
setInterval(() => {
  if (snap && snap.state === 'playing') {
    const left = snap.endsAt - Date.now();
    $('timer').textContent = fmtTime(left);
    const sec = Math.ceil(left / 1000);
    if (sec <= 10 && sec > 0 && sec !== lastTick) { lastTick = sec; Sound.play('tick'); }
  }
}, 250);

$('mode').onchange = () => {
  const h = $('mode').value === 'html';
  $('quizBox').classList.toggle('hidden', h);
  $('htmlBox').classList.toggle('hidden', !h);
};

$('create').onclick = async () => {
  $('err').textContent = '';
  try {
    const body = { duration: +$('dur').value, attacks: $('attacks').checked };
    if ($('mode').value === 'html') {
      const f = $('file').files[0];
      if (!f) throw new Error('Hãy chọn một file HTML.');
      body.html = await f.text();
      body.total = +$('total').value || 10;
    } else body.questions = $('qs').value;
    const r = await post('/api/create', body);
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

// ---------- sounds on the projector ----------
let prevState = null, lastEv, finished = new Set();
function teacherSounds() {
  const evs = snap.events || [];
  if (lastEv === undefined) lastEv = evs.length ? evs[evs.length - 1].id : 0;
  for (const ev of evs) {
    if (ev.id <= lastEv) continue;
    lastEv = ev.id;
    if (ev.type === 'bomb') Sound.play('boom');
    else if (ev.type === 'freeze') Sound.play('freeze');
    else if (ev.type === 'blocked') Sound.play('block');
    else if (ev.type === 'shield') Sound.play('shield');
    else if (ev.type === 'boost') Sound.play('boost');
  }
  for (const p of snap.players) {
    if (p.pos >= snap.top && !finished.has(p.id)) {
      finished.add(p.id);
      if (prevState === 'playing' && snap.state === 'playing') Sound.play('summit');
    }
  }
  if (prevState !== null) {
    if (prevState === 'lobby' && snap.state === 'playing') { Sound.play('start'); Fx.go('GO!'); }
    if (prevState !== 'ended' && snap.state === 'ended') { Sound.play('win'); Fx.rain(5000); }
  }
  prevState = snap.state;
}

$('mute').textContent = Sound.isMuted() ? '🔇' : '🔊';
$('mute').onclick = () => { $('mute').textContent = Sound.toggle() ? '🔇' : '🔊'; };
