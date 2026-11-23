// Climb the Mountain - English quiz race. No dependencies: only Node's built-in modules.
// Run: node server.js   (then open http://localhost:3000/teacher)
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = +process.env.PORT || 3000;
const TOP = 10; // number of correct answers needed to reach the summit
const PUB = path.join(__dirname, 'public');
const AVATARS = ['🦊','🐼','🐯','🐸','🐵','🦁','🐨','🐰','🐻','🐙','🦄','🐧','🐳','🦉','🐢','🐝','🦋','🐶','🐱','🐹'];

// [question, options, index of the correct option]
const SAMPLE = [
  ['She ___ to school every day.', ['go', 'goes', 'going', 'gone'], 1],
  ['What is the opposite of "ancient"?', ['old', 'modern', 'huge', 'quiet'], 1],
  ['I have lived here ___ 2019.', ['for', 'since', 'during', 'from'], 1],
  ['Choose the correct word: "There are many ___ in the park."', ['child', 'childs', 'children', 'childrens'], 2],
  ['"Delighted" means...', ['very sad', 'very happy', 'very tired', 'very angry'], 1],
  ['If it rains tomorrow, we ___ at home.', ['stay', 'stayed', 'will stay', 'would stay'], 2],
  ['Which word is a noun?', ['quickly', 'happiness', 'beautiful', 'run'], 1],
  ['He is ___ than his brother.', ['tall', 'taller', 'tallest', 'more tall'], 1],
  ['Past tense of "buy":', ['buyed', 'bought', 'boughten', 'buys'], 1],
  ['"Enormous" is closest in meaning to...', ['tiny', 'huge', 'fast', 'funny'], 1],
  ['She is interested ___ music.', ['on', 'at', 'in', 'of'], 2],
  ['I ___ my homework when you called.', ['do', 'was doing', 'am doing', 'does'], 1],
  ['Which sentence is correct?', ['He don\'t like tea.', 'He doesn\'t likes tea.', 'He doesn\'t like tea.', 'He not like tea.'], 2],
  ['A person who writes books is an...', ['author', 'actor', 'editor', 'artist'], 0],
  ['"I look forward to ___ you."', ['see', 'seeing', 'saw', 'seen'], 1],
  ['The plural of "mouse" (animal) is...', ['mouses', 'mice', 'mices', 'mouse'], 1],
  ['Choose the synonym of "begin".', ['finish', 'start', 'stop', 'close'], 1],
  ['There isn\'t ___ milk left.', ['some', 'any', 'many', 'a'], 1],
];

const rooms = new Map();

// ---- Optional Postgres (leaderboard). Active only when DATABASE_URL is set. ----
let pool = null;
if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false },
      max: 3,
    });
    pool.on('error', e => console.error('DB pool error:', e.message));
    pool.query(`create table if not exists results (
      id serial primary key,
      room_code text not null,
      player_name text not null,
      correct int not null,
      wrong int not null,
      pos int not null,
      finished boolean not null,
      finish_seconds int,
      played_at timestamptz not null default now()
    )`).then(() => console.log('Database ready.')).catch(e => { console.error('DB init failed:', e.message); pool = null; });
  } catch (e) {
    console.error('DATABASE_URL is set but the "pg" package is missing. Run: npm install');
  }
}

async function saveResults(r) {
  if (!pool) return;
  try {
    for (const p of r.players.values()) {
      await pool.query(
        'insert into results (room_code, player_name, correct, wrong, pos, finished, finish_seconds) values ($1,$2,$3,$4,$5,$6,$7)',
        [r.code, p.name, p.correct, p.wrong, Math.round(p.pos), !!p.finishedAt, p.finishedAt && r.startedAt ? Math.round((p.finishedAt - r.startedAt) / 1000) : null]
      );
    }
  } catch (e) { console.error('Saving results failed:', e.message); }
}

async function leaderboard() {
  if (!pool) return { enabled: false, rows: [] };
  try {
    const q = await pool.query(`
      select min(player_name) as name, sum(correct)::int as correct, count(*)::int as games,
             count(*) filter (where finished)::int as summits
      from results group by lower(player_name)
      order by correct desc, games asc limit 20`);
    return { enabled: true, rows: q.rows };
  } catch (e) { return { enabled: false, rows: [], error: e.message }; }
}

function parseQuestions(text) {
  // One question per line:  question | option A | option B | option C | option D | correct letter (A-D)
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const parts = line.split('|').map(s => s.trim());
    if (parts.length < 4) continue;
    const q = parts.shift();
    const a = parts.pop();
    const opts = parts.filter(Boolean);
    let idx = /^[A-Za-z]$/.test(a) ? a.toUpperCase().charCodeAt(0) - 65 : /^\d+$/.test(a) ? +a - 1 : -1;
    if (q && opts.length >= 2 && opts.length <= 6 && idx >= 0 && idx < opts.length) out.push([q, opts, idx]);
  }
  return out;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newCode() {
  for (;;) {
    const c = String(crypto.randomInt(1000, 10000));
    if (!rooms.has(c)) return c;
  }
}

function rank(a, b) {
  if (b.pos !== a.pos) return b.pos - a.pos;
  if (a.fin && b.fin) return a.fin - b.fin;
  if (a.fin) return -1;
  if (b.fin) return 1;
  return b.correct - a.correct;
}

// ---- Coins, items and attacks ----
const COIN_PER_CORRECT = 2;
const ITEMS = { shield: { cost: 3 }, boost: { cost: 4 }, bomb: { cost: 5, attack: true }, freeze: { cost: 5, attack: true } };
const FREEZE_MS = 5000;     // how long a frozen player cannot answer
const PROTECT_MS = 6000;    // a player who was just hit cannot be hit again for a short while

function unitsTotal(r) { return r.mode === 'activity' ? r.total : TOP; }

function syncPos(r, p, now) {
  const tot = unitsTotal(r);
  p.pos = Math.min(TOP, Math.round(p.units / tot * TOP * 100) / 100);
  if (p.units >= tot) { p.pos = TOP; if (!p.finishedAt) p.finishedAt = now; }
}

function applyCorrect(r, p, now) {
  const gain = p.boost ? 2 : 1;
  p.boost = false;
  p.correct++;
  p.coins += COIN_PER_CORRECT;
  p.units = Math.min(unitsTotal(r), p.units + gain);
  syncPos(r, p, now);
}

function addEvent(r, ev) {
  r.events.push({ id: ++r.evSeq, ...ev });
  if (r.events.length > 8) r.events.shift();
}

function snapshot(r) {
  const now = Date.now();
  const players = [...r.players.values()].map(p => ({
    id: p.id, name: p.name, av: p.av, i: p.i, pos: p.pos,
    fin: p.finishedAt, correct: p.correct, wrong: p.wrong,
    coins: p.coins, sh: p.shield, bo: p.boost, fz: Math.max(0, p.frozenUntil - now),
  }));
  players.sort(rank);
  return { state: r.state, endsAt: r.endsAt, top: TOP, total: r.mode === 'activity' ? r.total : r.questions.length, mode: r.mode, attacks: r.attacks, shop: ITEMS, events: r.events, players };
}

function broadcast(r) {
  const data = `data: ${JSON.stringify(snapshot(r))}\n\n`;
  for (const c of r.clients) c.res.write(data);
}

function endGame(r) {
  if (r.state === 'ended') return;
  r.state = 'ended';
  r.endsAt = Date.now();
  broadcast(r);
  saveResults(r);
}

setInterval(() => {
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (r.state === 'playing' && now >= r.endsAt) endGame(r);
    if (now - r.created > 6 * 3600 * 1000) { // clean up after 6 hours
      for (const c of r.clients) c.res.end();
      rooms.delete(code);
    }
  }
}, 1000);
setInterval(() => {
  for (const r of rooms.values()) for (const c of r.clients) c.res.write(': ping\n\n');
}, 20000);

function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', d => { s += d; if (s.length > 2600000) { reject(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

function currentQuestion(r, p) {
  if (!p.cur) {
    const qi = p.order[p.asked % p.order.length];
    const q = r.questions[qi];
    p.cur = { qi, perm: shuffle(q[1].map((_, i) => i)) };
  }
  return p.cur;
}

// Script injected into uploaded HTML activities: gives them window.climb.correct() / window.climb.wrong()
const HOOK = '<script>(function(){function s(t){try{parent.postMessage({climbGame:1,type:t},"*")}catch(e){}}window.climb={correct:function(){s("correct")},wrong:function(){s("wrong")}};})();</script>';
function injectHook(html) {
  const head = html.match(/<head[^>]*>/i) || html.match(/<html[^>]*>/i);
  return head ? html.replace(head[0], () => head[0] + HOOK) : HOOK + html;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

async function handleApi(req, res, url) {
  const p = url.pathname;
  if (req.method === 'GET' && p === '/api/info') {
    const ips = [];
    for (const list of Object.values(os.networkInterfaces()))
      for (const n of list || []) if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    return json(res, 200, { ips, port: PORT });
  }

  if (req.method === 'GET' && p === '/api/leaderboard') return json(res, 200, await leaderboard());

  if (req.method === 'GET' && p === '/api/activity') {
    const r = rooms.get(url.searchParams.get('code'));
    const pl = r && r.players.get(url.searchParams.get('id'));
    if (!pl || r.mode !== 'activity' || r.state === 'lobby') { res.writeHead(404); return res.end('Not available'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(injectHook(r.html));
  }

  if (req.method === 'GET' && p === '/api/question') {
    const r = rooms.get(url.searchParams.get('code'));
    const pl = r && r.players.get(url.searchParams.get('id'));
    if (!pl) return json(res, 404, { error: 'not found' });
    if (r.state !== 'playing') return json(res, 200, { state: r.state });
    if (pl.pos >= TOP) return json(res, 200, { state: 'playing', finished: true });
    const cur = currentQuestion(r, pl);
    const q = r.questions[cur.qi];
    return json(res, 200, { state: 'playing', q: q[0], options: cur.perm.map(i => q[1][i]), n: pl.asked + 1 });
  }

  if (req.method !== 'POST') return json(res, 404, { error: 'not found' });
  let body;
  try { body = await readBody(req); } catch { return json(res, 400, { error: 'bad request' }); }

  if (p === '/api/create') {
    const html = typeof body.html === 'string' ? body.html : '';
    if (html.length > 2500000) return json(res, 400, { error: 'File HTML quá lớn (tối đa khoảng 2 MB).' });
    let questions = html ? [] : parseQuestions(body.questions);
    if (!html && body.questions && String(body.questions).trim() && questions.length < 3)
      return json(res, 400, { error: 'Cần ít nhất 3 câu hỏi hợp lệ (mỗi dòng: câu hỏi | A | B | C | D | đáp án đúng).' });
    if (!html && !questions.length) questions = SAMPLE;
    const code = newCode();
    const hostKey = crypto.randomBytes(8).toString('hex');
    const duration = Math.min(30, Math.max(1, +body.duration || 5));
    const total = Math.min(200, Math.max(1, Math.round(+body.total) || 10));
    rooms.set(code, { code, hostKey, questions, duration, mode: html ? 'activity' : 'quiz', html, total, attacks: body.attacks !== false, events: [], evSeq: 0, state: 'lobby', endsAt: null, players: new Map(), clients: new Set(), created: Date.now(), seq: 0 });
    return json(res, 200, { code, hostKey, questions: questions.length, mode: html ? 'activity' : 'quiz' });
  }

  const r = rooms.get(String(body.code || ''));
  if (!r) return json(res, 404, { error: 'Không tìm thấy phòng / Room not found' });

  if (p === '/api/join') {
    if (r.state === 'ended') return json(res, 400, { error: 'This game has ended.' });
    const name = String(body.name || '').trim().slice(0, 14);
    if (!name) return json(res, 400, { error: 'Please enter your name.' });
    if (r.players.size >= 60) return json(res, 400, { error: 'Room is full.' });
    const id = crypto.randomBytes(6).toString('hex');
    const i = r.seq++;
    r.players.set(id, {
      id, name, i, av: AVATARS[i % AVATARS.length], pos: 0, correct: 0, wrong: 0, finishedAt: null,
      units: 0, coins: 0, shield: false, boost: false, frozenUntil: 0, protectedUntil: 0, asked: 0, cur: null, order: shuffle(r.questions.map((_, k) => k)),
    });
    broadcast(r);
    return json(res, 200, { id });
  }

  if (p === '/api/start') {
    if (body.hostKey !== r.hostKey) return json(res, 403, { error: 'forbidden' });
    if (r.state !== 'lobby') return json(res, 400, { error: 'already started' });
    r.state = 'playing';
    r.startedAt = Date.now();
    r.endsAt = r.startedAt + r.duration * 60000;
    broadcast(r);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/end') {
    if (body.hostKey !== r.hostKey) return json(res, 403, { error: 'forbidden' });
    endGame(r);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/buy') {
    const pl = r.players.get(body.id);
    const item = ITEMS[body.item];
    const now = Date.now();
    const fail = msg => json(res, 400, { error: msg });
    if (!pl || !item || r.state !== 'playing') return fail('Not available now.');
    if (pl.units >= unitsTotal(r)) return fail('You are already at the summit!');
    if (pl.frozenUntil > now) return json(res, 429, { error: 'frozen' });
    if (item.attack && !r.attacks) return fail('Attacks are turned off.');
    if (pl.coins < item.cost) return fail('Not enough coins.');
    if (body.item === 'shield' && pl.shield) return fail('You already have a shield.');
    if (body.item === 'boost' && pl.boost) return fail('Boost is already ready.');
    let result = 'ok';
    if (item.attack) {
      const t = r.players.get(body.target);
      if (!t || t === pl) return fail('Pick another player.');
      if (t.units >= unitsTotal(r)) return fail(t.name + ' is already at the summit.');
      if (t.shield) {
        pl.coins -= item.cost;
        t.shield = false;
        result = 'blocked';
        addEvent(r, { type: 'blocked', kind: body.item, from: pl.name, fromId: pl.id, to: t.name, toId: t.id });
      } else {
        if (t.protectedUntil > now) return fail(t.name + ' was just hit. Pick someone else.');
        if (body.item === 'freeze' && t.frozenUntil > now) return fail(t.name + ' is already frozen.');
        pl.coins -= item.cost;
        if (body.item === 'bomb') {
          const loss = Math.max(1, Math.ceil(unitsTotal(r) * 0.15));
          t.units = Math.max(0, t.units - loss);
          syncPos(r, t, now);
        } else {
          t.frozenUntil = now + FREEZE_MS;
          setTimeout(() => broadcast(r), FREEZE_MS + 50);
        }
        t.protectedUntil = now + PROTECT_MS;
        addEvent(r, { type: body.item, from: pl.name, fromId: pl.id, to: t.name, toId: t.id });
      }
    } else {
      pl.coins -= item.cost;
      pl[body.item] = true;
      addEvent(r, { type: body.item, from: pl.name, fromId: pl.id, to: pl.name, toId: pl.id });
    }
    broadcast(r);
    return json(res, 200, { ok: true, coins: pl.coins, result });
  }

  if (p === '/api/progress') {
    const pl = r.players.get(body.id);
    if (!pl || r.mode !== 'activity' || r.state !== 'playing' || pl.pos >= TOP) return json(res, 400, { error: 'not playing' });
    if (body.type !== 'correct' && body.type !== 'wrong') return json(res, 400, { error: 'bad type' });
    const now = Date.now();
    if (pl.frozenUntil > now) return json(res, 429, { error: 'frozen' });
    if (pl.lastProg && now - pl.lastProg < 200) return json(res, 200, { ok: true, ignored: true });
    pl.lastProg = now;
    if (body.type === 'correct') applyCorrect(r, pl, now);
    else pl.wrong++;
    broadcast(r);
    if ([...r.players.values()].every(x => x.pos >= TOP)) endGame(r);
    return json(res, 200, { ok: true, pos: pl.pos });
  }

  if (p === '/api/answer') {
    const pl = r.players.get(body.id);
    if (!pl || r.state !== 'playing' || !pl.cur || pl.pos >= TOP) return json(res, 400, { error: 'not playing' });
    if (pl.frozenUntil > Date.now()) return json(res, 429, { error: 'frozen' });
    const q = r.questions[pl.cur.qi];
    const choice = +body.choice;
    if (!(choice >= 0 && choice < pl.cur.perm.length)) return json(res, 400, { error: 'bad choice' });
    const correct = pl.cur.perm[choice] === q[2];
    const correctIndex = pl.cur.perm.indexOf(q[2]);
    pl.cur = null;
    pl.asked++;
    if (correct) applyCorrect(r, pl, Date.now());
    else pl.wrong++;
    broadcast(r);
    if ([...r.players.values()].every(x => x.pos >= TOP)) endGame(r);
    return json(res, 200, { correct, correctIndex, pos: pl.pos, finished: pl.pos >= TOP });
  }

  json(res, 404, { error: 'not found' });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/events') {
      const r = rooms.get(url.searchParams.get('code'));
      const role = url.searchParams.get('role');
      if (!r) { res.writeHead(404); return res.end(); }
      if (role === 'host' && url.searchParams.get('key') !== r.hostKey) { res.writeHead(403); return res.end(); }
      if (role === 'player' && !r.players.has(url.searchParams.get('id'))) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 2000\n\n');
      const client = { res };
      r.clients.add(client);
      req.on('close', () => r.clients.delete(client));
      return res.write(`data: ${JSON.stringify(snapshot(r))}\n\n`);
    }
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);

    let rel = url.pathname === '/' ? '/index.html' : url.pathname === '/teacher' ? '/teacher.html' : url.pathname === '/play' ? '/play.html' : url.pathname === '/leaderboard' ? '/leaderboard.html' : url.pathname;
    const file = path.normalize(path.join(PUB, rel));
    if (!file.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nClimb the Mountain is running!\n  Teacher:  http://localhost:${PORT}/teacher`);
  for (const list of Object.values(os.networkInterfaces()))
    for (const n of list || []) if (n.family === 'IPv4' && !n.internal) console.log(`  Students: http://${n.address}:${PORT}/   (same Wi-Fi)`);
  console.log('');
});
