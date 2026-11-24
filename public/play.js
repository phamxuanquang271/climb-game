const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let me = null; // { code, id, name }
let snap = null;
let loading = false;
let streak = 0, bestRank = null; // a question is being fetched / answered

$('code').value = params.get('code') || '';

async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Something went wrong');
  return j;
}

$('go').onclick = async () => {
  $('err').textContent = '';
  const code = $('code').value.trim();
  const name = $('name').value.trim();
  try {
    const r = await post('/api/join', { code, name });
    me = { code, id: r.id, name };
    sessionStorage.setItem('climb', JSON.stringify(me));
    start();
  } catch (e) { $('err').textContent = e.message; }
};
$('name').addEventListener('keydown', e => { if (e.key === 'Enter') $('go').click(); });

function start() {
  $('join').classList.add('hidden');
  $('main').classList.remove('hidden');
  $('me').textContent = me.name;
  const es = new EventSource(`/events?code=${me.code}&role=player&id=${me.id}`);
  es.onmessage = e => { snap = JSON.parse(e.data); snap._at = Date.now(); update(); };
  es.onerror = () => {
    // 404 (room gone) closes the stream permanently
    if (es.readyState === EventSource.CLOSED) {
      sessionStorage.removeItem('climb');
      $('main').classList.add('hidden');
      $('join').classList.remove('hidden');
      $('err').textContent = 'The game is no longer available. Please join again.';
    }
  };
}

function showStreak() {
  let s = $('streak');
  if (!s) { s = document.createElement('span'); s.id = 'streak'; s.className = 'streak'; $('me').after(s); }
  s.textContent = streak >= 2 ? '🔥 x' + streak : '';
  s.classList.remove('bump'); void s.offsetWidth; if (streak >= 2) s.classList.add('bump');
}

function panel(name) {
  for (const id of ['wait', 'quiz', 'activity', 'top', 'over']) $(id).classList.toggle('hidden', id !== name);
}

function update() {
  renderMountain($('mtn'), snap, me.id);
  const mine = snap.players.find(p => p.id === me.id);
  handleEvents();
  if (mine && snap.state === 'playing') {
    const rank = snap.players.findIndex(q => q.id === me.id);
    if (bestRank !== null && rank < bestRank && snap.players.length > 1) {
      Sound.play('pass');
      const c = Fx.center($('mtn')); Fx.float(c.x, c.y, '⬆️ #' + (rank + 1), '#2f80ed');
    }
    bestRank = rank;
  } else if (snap.state !== 'playing') { bestRank = null; streak = 0; showStreak(); }
  renderShop(mine);
  soundState(mine);
  if (snap.state === 'lobby') {
    panel('wait');
  } else if (snap.state === 'playing') {
    if (mine && mine.pos >= snap.top) panel('top');
    else if (snap.mode === 'activity') showActivity();
    else if ($('quiz').classList.contains('hidden') && !loading) nextQuestion();
  } else {
    panel('over');
    const rk = snap.players.findIndex(p => p.id === me.id) + 1;
    $('result').textContent = rk === 1 ? '🥇 You won!' : rk ? `You finished #${rk}` : 'Game over';
    $('lb').innerHTML = leaderboardHtml(snap, me.id, 10);
  }
}

function showActivity() {
  $('wrap').classList.remove('narrow');
  $('mtn').classList.add('compact');
  const f = $('frame');
  if (!f.dataset.loaded) { f.src = `/api/activity?code=${me.code}&id=${me.id}`; f.dataset.loaded = '1'; }
  panel('activity');
}

// The HTML activity (inside the iframe) reports answers with climb.correct() / climb.wrong()
window.addEventListener('message', e => {
  const f = $('frame');
  if (!me || e.source !== f.contentWindow) return;
  const d = e.data;
  if (!d || d.climbGame !== 1 || (d.type !== 'correct' && d.type !== 'wrong')) return;
  Sound.play(d.type);
  post('/api/progress', { code: me.code, id: me.id, type: d.type }).catch(() => {});
});

setInterval(() => {
  if (snap) renderShop(snap.players.find(p => p.id === me.id));
  if (snap && snap.state === 'playing') {
    const left = snap.endsAt - Date.now();
    $('timer').textContent = fmtTime(left);
    const sec = Math.ceil(left / 1000);
    if (sec <= 10 && sec > 0 && sec !== lastTick) { lastTick = sec; Sound.play('tick'); }
  }
  else $('timer').textContent = '';
}, 250);
let lastTick = 0;

async function nextQuestion() {
  loading = true;
  try {
    const q = await (await fetch(`/api/question?code=${me.code}&id=${me.id}`)).json();
    if (q.state !== 'playing' || q.finished || !q.q) { loading = false; return; }
    $('qn').textContent = 'Question ' + q.n;
    $('qtext').textContent = q.q;
    $('fb').textContent = '';
    $('fb').className = 'feedback';
    $('opts').innerHTML = '';
    q.options.forEach((text, i) => {
      const b = document.createElement('button');
      b.className = 'opt';
      b.textContent = text;
      b.onclick = () => answer(i);
      $('opts').appendChild(b);
    });
    panel('quiz');
  } catch {}
  loading = false;
}

async function answer(choice) {
  loading = true;
  const btns = [...document.querySelectorAll('.opt')];
  btns.forEach(b => (b.disabled = true));
  try {
    const r = await post('/api/answer', { code: me.code, id: me.id, choice });
    Sound.play(r.correct ? 'correct' : 'wrong');
    if (r.correct) {
      streak++;
      const c = Fx.center(btns[choice]); Fx.confetti(c.x, c.y, 22); Fx.float(c.x, c.y - 30, '+2 🪙');
      if (streak >= 3 && streak % 2 === 1) { Fx.banner('🔥 ' + streak + ' in a row!', streak >= 5 ? 'hot' : ''); Sound.play('combo'); }
    } else {
      streak = 0;
      $('quiz').classList.add('shakecard'); setTimeout(() => $('quiz').classList.remove('shakecard'), 450);
    }
    showStreak();
    btns.forEach((b, i) => {
      if (i === r.correctIndex) b.classList.add('right');
      else if (i === choice) b.classList.add('wrong');
      else b.classList.add('dim');
    });
    $('fb').textContent = r.correct ? '✅ Correct! Climb!' : '❌ Not quite. Try the next one!';
    $('fb').className = 'feedback ' + (r.correct ? 'ok' : 'no');
    await new Promise(res => setTimeout(res, r.correct ? 900 : 1700));
    $('quiz').classList.add('hidden');
    loading = false;
    if (r.finished) { panel('top'); return; }
    if (snap && snap.state === 'playing') await nextQuestion();
  } catch (e) {
    if (e.message === 'frozen') { btns.forEach(b => (b.disabled = false)); loading = false; return; }
    // game probably ended; the next snapshot will switch the screen
    $('quiz').classList.add('hidden');
    loading = false;
    if (snap) update();
  }
  loading = false;
}

// Resume after reload
try {
  const saved = JSON.parse(sessionStorage.getItem('climb') || 'null');
  if (saved && (!params.get('code') || params.get('code') === saved.code)) { me = saved; start(); }
} catch {}

// ---------- shop, attacks, toasts ----------
const ICON = { shield: '🛡️', boost: '⚡', bomb: '💣', freeze: '❄️' };
const NAME = { shield: 'Shield', boost: 'Boost', bomb: 'Bomb', freeze: 'Freeze' };
const HELP = { shield: 'blocks 1 attack', boost: 'next answer x2', bomb: 'push a friend down', freeze: 'friend waits 5s' };
let shopBuilt = false, lastEv, prevCoins, wasFrozen = false;
let toastTimer;

function toast(msg, bad) {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast' + (bad ? ' bad' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2600);
}

function buy(item, target) {
  post('/api/buy', { code: me.code, id: me.id, item, target })
    .then(() => Sound.play(item === 'shield' ? 'shield' : item === 'boost' ? 'boost' : 'coin'))
    .catch(e => { if (e.message !== 'frozen') { toast(e.message, true); Sound.play('wrong'); } });
}

function buildShop() {
  const box = $('items');
  box.innerHTML = '';
  for (const key of ['shield', 'boost', 'bomb', 'freeze']) {
    if (!snap.shop[key]) continue;
    if (snap.shop[key].attack && !snap.attacks) continue;
    const b = document.createElement('button');
    b.className = 'item';
    b.dataset.item = key;
    b.innerHTML = `${ICON[key]} ${NAME[key]}<small>🪙 ${snap.shop[key].cost}</small>`;
    b.title = HELP[key];
    b.onclick = () => (snap.shop[key].attack ? openPicker(key) : buy(key));
    box.appendChild(b);
  }
  shopBuilt = true;
}

function renderShop(mine) {
  if (!snap || !mine) return;
  const active = snap.state === 'playing' && mine.pos < snap.top;
  $('shop').classList.toggle('hidden', !active);
  const fz = frozenLeft(mine, snap);
  const isFrozen = snap.state === 'playing' && fz > 0;
  $('frozenov').classList.toggle('hidden', !isFrozen);
  if (isFrozen && !wasFrozen) buildFlakes();
  wasFrozen = isFrozen;
  if (fz > 0) $('fzsec').textContent = Math.ceil(fz / 1000) + 's';
  if (!active) return;
  if (!shopBuilt) buildShop();
  if (prevCoins !== undefined && mine.coins > prevCoins) {
    const c = Fx.center($('coins'));
    Fx.float(c.x + 26, c.y - 12, '+' + (mine.coins - prevCoins) + ' 🪙');
    $('coins').classList.add('bump'); setTimeout(() => $('coins').classList.remove('bump'), 450);
  }
  prevCoins = mine.coins;
  $('coins').textContent = mine.coins;
  for (const b of $('items').children) {
    const k = b.dataset.item;
    b.disabled = fz > 0 || mine.coins < snap.shop[k].cost || (k === 'shield' && mine.sh) || (k === 'boost' && mine.bo);
  }
  $('status').textContent = [mine.sh ? '🛡️ Shield ready' : '', mine.bo ? '⚡ Boost ready' : ''].filter(Boolean).join('   ') || 'Earn 🪙 with every correct answer!';
}

function openPicker(item) {
  const others = snap.players.filter(p => p.id !== me.id && p.pos < snap.top);
  $('pickTitle').textContent = (item === 'bomb' ? '💣 Bomb who?' : '❄️ Freeze who?');
  $('pickList').innerHTML = '';
  if (!others.length) $('pickList').innerHTML = '<p class="muted">No one to target right now.</p>';
  for (const p of others) {
    const b = document.createElement('button');
    b.className = 'pick';
    b.innerHTML = `<span class="av">${p.av}</span><span>${esc(p.name)}</span><span class="pc">${Math.round(p.pos / snap.top * 100)}%</span>`;
    b.onclick = () => { $('picker').classList.add('hidden'); buy(item, p.id); };
    $('pickList').appendChild(b);
  }
  $('picker').classList.remove('hidden');
}
$('pickCancel').onclick = () => $('picker').classList.add('hidden');

function handleEvents() {
  const evs = snap.events || [];
  if (lastEv === undefined) { lastEv = evs.length ? evs[evs.length - 1].id : 0; return; }
  for (const ev of evs) {
    if (ev.id <= lastEv) continue;
    lastEv = ev.id;
    if (ev.toId === me.id && ev.type === 'bomb') { toast(`💣 ${ev.from} bombed you!`, true); Sound.play('boom'); }
    else if (ev.toId === me.id && ev.type === 'freeze') { toast(`❄️ ${ev.from} froze you!`, true); Sound.play('freeze'); }
    else if (ev.type === 'blocked' && ev.toId === me.id) { toast(`🛡️ Your shield blocked ${ev.from}'s attack!`); Sound.play('block'); }
    else if (ev.type === 'blocked' && ev.fromId === me.id) { toast(`🛡️ ${ev.to}'s shield blocked your attack!`, true); Sound.play('block'); }
  }
}

// ---------- sounds that follow the game state ----------
let prevState = null, wasTop = false;
function soundState(mine) {
  const reached = !!(mine && mine.pos >= snap.top);
  if (prevState !== null) {
    if (prevState === 'lobby' && snap.state === 'playing') { Sound.play('start'); Fx.go('GO!'); }
    if (prevState !== 'ended' && snap.state === 'ended') {
      const rank = snap.players.findIndex(p => p.id === me.id);
      Sound.play(rank === 0 ? 'win' : 'end');
      if (rank === 0) Fx.rain(3500); else Fx.confetti(window.innerWidth / 2, window.innerHeight / 2, 40);
    } else if (reached && !wasTop && snap.state === 'playing') Sound.play('summit');
  }
  prevState = snap.state;
  wasTop = reached;
}

$('mute').textContent = Sound.isMuted() ? '🔇' : '🔊';
$('mute').onclick = () => { $('mute').textContent = Sound.toggle() ? '🔇' : '🔊'; };

function buildFlakes() {
  const box = $('flakes');
  box.innerHTML = '';
  for (let i = 0; i < 22; i++) {
    const s = document.createElement('span');
    s.textContent = '❄️';
    s.style.left = Math.random() * 100 + '%';
    s.style.fontSize = (14 + Math.random() * 22) + 'px';
    s.style.animationDuration = (2.5 + Math.random() * 3) + 's';
    s.style.animationDelay = (-Math.random() * 4) + 's';
    box.appendChild(s);
  }
}
