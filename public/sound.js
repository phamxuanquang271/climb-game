// Sound effects made with the Web Audio API (no audio files needed).
// Usage: Sound.play('correct');  Sound.toggle();  Sound.isMuted();
const Sound = (() => {
  let ctx = null;
  let muted = false;
  const lastPlayed = {};
  try { muted = localStorage.getItem('climb-muted') === '1'; } catch (e) {}

  function ensure() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    }
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    return ctx;
  }

  function tone(c, o) {
    const osc = c.createOscillator();
    const g = c.createGain();
    const a = o.a || 0.01, d = o.d || 0.2, t = c.currentTime + (o.at || 0);
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + a + d);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol || 0.2, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
    osc.connect(g); g.connect(c.destination);
    osc.start(t); osc.stop(t + a + d + 0.05);
  }

  function noise(c, o) {
    const len = Math.max(1, Math.floor(c.sampleRate * o.d));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    const g = c.createGain();
    const t = c.currentTime + (o.at || 0);
    filter.frequency.setValueAtTime(o.f1, t);
    filter.frequency.exponentialRampToValueAtTime(o.f2, t + o.d);
    g.gain.setValueAtTime(o.vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + o.d);
    src.connect(filter); filter.connect(g); g.connect(c.destination);
    src.start(t);
  }

  const fx = {
    correct(c) { tone(c, { f: 660, vol: 0.18, d: 0.18 }); tone(c, { f: 880, vol: 0.18, d: 0.28, at: 0.1 }); },
    wrong(c)   { tone(c, { f: 220, f2: 110, type: 'sawtooth', vol: 0.12, d: 0.28 }); },
    coin(c)    { tone(c, { f: 1200, type: 'triangle', vol: 0.15, d: 0.08 }); tone(c, { f: 1700, type: 'triangle', vol: 0.15, d: 0.2, at: 0.07 }); },
    shield(c)  { [600, 900, 1250].forEach((f, i) => tone(c, { f, vol: 0.13, d: 0.18, at: i * 0.07 })); },
    boost(c)   { tone(c, { f: 220, f2: 1000, type: 'square', vol: 0.07, a: 0.02, d: 0.32 }); },
    boom(c)    { noise(c, { vol: 0.35, d: 0.6, f1: 2500, f2: 80 }); tone(c, { f: 120, f2: 40, vol: 0.35, a: 0.005, d: 0.45 }); },
    freeze(c)  { tone(c, { f: 1800, f2: 500, type: 'triangle', vol: 0.15, d: 0.5 }); tone(c, { f: 2600, vol: 0.08, d: 0.3, at: 0.05 }); },
    block(c)   { tone(c, { f: 300, type: 'square', vol: 0.12, d: 0.08 }); tone(c, { f: 450, type: 'square', vol: 0.12, d: 0.15, at: 0.08 }); },
    start(c)   { [523, 659, 784].forEach((f, i) => tone(c, { f, vol: 0.16, d: 0.22, at: i * 0.12 })); },
    summit(c)  { [523, 659, 784, 1047].forEach((f, i) => tone(c, { f, vol: 0.17, d: 0.3, at: i * 0.11 })); },
    win(c)     { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(c, { f, vol: 0.17, d: 0.28, at: i * 0.12 })); },
    end(c)     { [784, 659, 523].forEach((f, i) => tone(c, { f, vol: 0.15, d: 0.3, at: i * 0.16 })); },
    tick(c)    { tone(c, { f: 1000, type: 'square', vol: 0.05, a: 0.003, d: 0.05 }); },
  };

  // Browsers only allow sound after a tap/click, so unlock on the first interaction.
  const unlock = () => ensure();
  document.addEventListener('pointerdown', unlock);
  document.addEventListener('keydown', unlock);

  return {
    play(name) {
      if (muted || !fx[name]) return;
      const now = Date.now();
      if (name !== 'tick' && lastPlayed[name] && now - lastPlayed[name] < 250) return; // avoid a pile-up
      lastPlayed[name] = now;
      const c = ensure();
      if (c) { try { fx[name](c); } catch (e) {} }
    },
    toggle() {
      muted = !muted;
      try { localStorage.setItem('climb-muted', muted ? '1' : '0'); } catch (e) {}
      if (!muted) this.play('coin');
      return muted;
    },
    isMuted() { return muted; },
    names: Object.keys(fx),
    _setContext(c) { ctx = c; },   // for tests
    _fx: fx,
  };
})();
