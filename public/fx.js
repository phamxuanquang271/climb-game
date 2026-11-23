// Visual effects: particles drawn on one transparent canvas laid over the page.
// Usage: Fx.confetti(x, y, 30);  Fx.explosion(x, y);  Fx.float(x, y, '+2 🪙');  Fx.go();
const Fx = (() => {
  const reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const COLORS = ['#ff5c8a', '#ffd23f', '#3bceac', '#4cc9f0', '#9b5de5', '#ff9f1c'];
  let cv = null, g = null, W = 0, H = 0, dpr = 1, raf = 0, parts = [], rainUntil = 0;

  const rnd = (a, b) => a + Math.random() * (b - a);

  function setup() {
    if (cv) return true;
    try {
      cv = document.createElement('canvas');
      cv.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:80';
      document.body.appendChild(cv);
      g = cv.getContext('2d');
      resize();
      window.addEventListener('resize', resize);
      return true;
    } catch (e) { return false; }
  }

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function add(p) {
    if (reduce || !setup()) return;
    if (parts.length > 350) parts.shift();
    p.life = p.maxLife = p.life || 60;
    parts.push(p);
    if (!raf) raf = requestAnimationFrame(tick);
  }

  function tick() {
    raf = 0;
    g.clearRect(0, 0, W, H);
    if (rainUntil > Date.now()) {
      for (let i = 0; i < 3; i++) add({ kind: 'rect', x: rnd(0, W), y: -10, vx: rnd(-1, 1), vy: rnd(2, 4.5), g: 0.02, size: rnd(6, 11), rot: rnd(0, 6), vr: rnd(-.2, .2), color: COLORS[(Math.random() * COLORS.length) | 0], life: 160 });
    }
    parts = parts.filter(p => p.life > 0);
    for (const p of parts) {
      p.life--;
      p.vy += p.g || 0;
      p.vx *= p.drag || 1; p.vy *= p.drag || 1;
      p.x += p.vx; p.y += p.vy;
      p.rot = (p.rot || 0) + (p.vr || 0);
      const t = p.life / p.maxLife;
      g.save();
      g.globalAlpha = Math.max(0, Math.min(1, t * 1.6));
      g.translate(p.x, p.y);
      if (p.kind === 'rect') { g.rotate(p.rot); g.fillStyle = p.color; g.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2); }
      else if (p.kind === 'circle') { g.fillStyle = p.color; g.beginPath(); g.arc(0, 0, p.size * (p.grow ? (1.6 - t) : 1), 0, 6.3); g.fill(); }
      else if (p.kind === 'ring') { g.strokeStyle = p.color; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, p.size * (2.2 - t * 1.5), 0, 6.3); g.stroke(); }
      else if (p.kind === 'text') {
        const s = p.size * (p.pop ? Math.min(1.4, 0.6 + (1 - t) * 3) : 1);
        g.font = `${s}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle';
        if (p.color) { g.fillStyle = p.color; g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,.9)'; g.strokeText(p.text, 0, 0); }
        g.fillText(p.text, 0, 0);
      }
      g.restore();
    }
    if (parts.length || rainUntil > Date.now()) raf = requestAnimationFrame(tick);
  }

  function ring(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * 6.283;
      add({ kind: 'circle', x, y, vx: Math.cos(a) * 3, vy: Math.sin(a) * 3, drag: .94, size: 3, color, life: 28 });
    }
  }

  return {
    confetti(x, y, n = 28) {
      for (let i = 0; i < n; i++) {
        const a = rnd(-Math.PI * 0.95, -Math.PI * 0.05), s = rnd(3, 8);
        add({ kind: 'rect', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, g: 0.22, drag: .985, size: rnd(6, 11), rot: rnd(0, 6), vr: rnd(-.3, .3), color: COLORS[(Math.random() * COLORS.length) | 0], life: rnd(55, 85) });
      }
    },
    explosion(x, y) {
      add({ kind: 'text', text: '💥', x, y, vx: 0, vy: -.3, size: 64, pop: true, life: 40 });
      for (let i = 0; i < 22; i++) {
        const a = rnd(0, 6.283), s = rnd(2, 7);
        add({ kind: 'circle', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: .93, size: rnd(2, 5), color: ['#ffb300', '#ff6d00', '#ffe082', '#d84315'][(Math.random() * 4) | 0], life: rnd(25, 45) });
      }
      for (let i = 0; i < 8; i++) {
        add({ kind: 'circle', x: x + rnd(-10, 10), y: y + rnd(-6, 6), vx: rnd(-1, 1), vy: rnd(-2, -.5), drag: .97, size: rnd(7, 12), grow: true, color: 'rgba(90,90,90,.55)', life: rnd(40, 65) });
      }
    },
    ice(x, y) {
      add({ kind: 'text', text: '❄️', x, y, vx: 0, vy: -.2, size: 56, pop: true, life: 45 });
      for (let i = 0; i < 12; i++) {
        const a = rnd(0, 6.283), s = rnd(1.5, 5);
        add({ kind: 'text', text: '❄️', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: .95, size: rnd(12, 22), life: rnd(35, 55) });
      }
      ring(x, y, '#9fdcff', 14);
    },
    shieldPop(x, y) {
      add({ kind: 'ring', x, y, size: 26, color: '#4cc9f0', life: 30 });
      add({ kind: 'text', text: '🛡️', x, y: y - 8, vx: 0, vy: -.6, size: 40, pop: true, life: 40 });
      ring(x, y, '#4cc9f0', 10);
    },
    sparkle(x, y) {
      for (let i = 0; i < 8; i++) {
        add({ kind: 'text', text: i % 2 ? '✨' : '⭐', x: x + rnd(-14, 14), y: y + rnd(-8, 8), vx: rnd(-1.2, 1.2), vy: rnd(-2.6, -.6), g: .03, size: rnd(12, 20), life: rnd(30, 50) });
      }
    },
    coins(x, y, n = 6) {
      for (let i = 0; i < n; i++) {
        add({ kind: 'text', text: '🪙', x, y, vx: rnd(-2.5, 2.5), vy: rnd(-6, -3), g: .3, size: rnd(16, 22), life: 50 });
      }
    },
    float(x, y, text, color) {
      add({ kind: 'text', text, x, y, vx: 0, vy: -1.2, size: 24, pop: true, color: color || '#e08600', life: 55 });
    },
    rain(ms) { if (reduce || !setup()) return; rainUntil = Date.now() + (ms || 2500); if (!raf) raf = requestAnimationFrame(tick); },
    go(text) {
      if (reduce) return;
      const d = document.createElement('div');
      d.className = 'gobanner';
      d.textContent = text || 'GO!';
      document.body.appendChild(d);
      setTimeout(() => d.remove(), 1400);
    },
    center(el) {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
  };
})();
