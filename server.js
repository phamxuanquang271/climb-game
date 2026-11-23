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

function snapshot(r) {
  const players = [...r.players.values()].map(p => ({
    id: p.id, name: p.name, av: p.av, i: p.i, pos: p.pos,
    fin: p.finishedAt, correct: p.correct, wrong: p.wrong,
  }));
  players.sort(rank);
  return { state: r.state, endsAt: r.endsAt, top: TOP, total: r.questions.length, players };
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
    req.on('data', d => { s += d; if (s.length > 200000) { reject(new Error('too big')); req.destroy(); } });
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

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

async function handleApi(req, res, url) {
  const p = url.pathname;
  if (req.method === 'GET' && p === '/api/info') {
    const ips = [];
    for (const list of Object.values(os.networkInterfaces()))
      for (const n of list || []) if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
    return json(res, 200, { ips, port: PORT });
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
    let questions = parseQuestions(body.questions);
    if (body.questions && String(body.questions).trim() && questions.length < 3)
      return json(res, 400, { error: 'Cần ít nhất 3 câu hỏi hợp lệ (mỗi dòng: câu hỏi | A | B | C | D | đáp án đúng).' });
    if (!questions.length) questions = SAMPLE;
    const code = newCode();
    const hostKey = crypto.randomBytes(8).toString('hex');
    const duration = Math.min(30, Math.max(1, +body.duration || 5));
    rooms.set(code, { code, hostKey, questions, duration, state: 'lobby', endsAt: null, players: new Map(), clients: new Set(), created: Date.now(), seq: 0 });
    return json(res, 200, { code, hostKey, questions: questions.length });
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
      asked: 0, cur: null, order: shuffle(r.questions.map((_, k) => k)),
    });
    broadcast(r);
    return json(res, 200, { id });
  }

  if (p === '/api/start') {
    if (body.hostKey !== r.hostKey) return json(res, 403, { error: 'forbidden' });
    if (r.state !== 'lobby') return json(res, 400, { error: 'already started' });
    r.state = 'playing';
    r.endsAt = Date.now() + r.duration * 60000;
    broadcast(r);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/end') {
    if (body.hostKey !== r.hostKey) return json(res, 403, { error: 'forbidden' });
    endGame(r);
    return json(res, 200, { ok: true });
  }

  if (p === '/api/answer') {
    const pl = r.players.get(body.id);
    if (!pl || r.state !== 'playing' || !pl.cur || pl.pos >= TOP) return json(res, 400, { error: 'not playing' });
    const q = r.questions[pl.cur.qi];
    const choice = +body.choice;
    if (!(choice >= 0 && choice < pl.cur.perm.length)) return json(res, 400, { error: 'bad choice' });
    const correct = pl.cur.perm[choice] === q[2];
    const correctIndex = pl.cur.perm.indexOf(q[2]);
    pl.cur = null;
    pl.asked++;
    if (correct) {
      pl.correct++;
      pl.pos = Math.min(TOP, pl.pos + 1);
      if (pl.pos >= TOP) pl.finishedAt = Date.now();
    } else pl.wrong++;
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

    let rel = url.pathname === '/' ? '/index.html' : url.pathname === '/teacher' ? '/teacher.html' : url.pathname === '/play' ? '/play.html' : url.pathname;
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
