const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let me = null; // { code, id, name }
let snap = null;
let loading = false; // a question is being fetched / answered

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
  es.onmessage = e => { snap = JSON.parse(e.data); update(); };
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

function panel(name) {
  for (const id of ['wait', 'quiz', 'top', 'over']) $(id).classList.toggle('hidden', id !== name);
}

function update() {
  renderMountain($('mtn'), snap, me.id);
  const mine = snap.players.find(p => p.id === me.id);
  if (snap.state === 'lobby') {
    panel('wait');
  } else if (snap.state === 'playing') {
    if (mine && mine.pos >= snap.top) panel('top');
    else if ($('quiz').classList.contains('hidden') && !loading) nextQuestion();
  } else {
    panel('over');
    const rk = snap.players.findIndex(p => p.id === me.id) + 1;
    $('result').textContent = rk === 1 ? '🥇 You won!' : rk ? `You finished #${rk}` : 'Game over';
    $('lb').innerHTML = leaderboardHtml(snap, me.id, 10);
  }
}

setInterval(() => {
  if (snap && snap.state === 'playing') $('timer').textContent = fmtTime(snap.endsAt - Date.now());
  else $('timer').textContent = '';
}, 250);

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
