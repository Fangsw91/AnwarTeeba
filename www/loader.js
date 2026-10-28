/* حركة تحميل خاصة بالشعار: الشمس تشرق وأشعة الباركود تنبثق ثم يمرّ ماسح ضوئي */
(function (g) {
  const NS = 'http://www.w3.org/2000/svg', N = '#28235d', R = '#e01f26', W = '#fff';
  const ease = t => 1 - Math.pow(1 - Math.max(0, Math.min(1, t)), 3);
  const clamp = t => Math.max(0, Math.min(1, t));
  const back = t => { t = clamp(t); const c = 1.7; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const WIDTHS = [9, 5, 8, 4, 9, 4, 8, 5, 9];
  function el(tag, attrs, parent) { const e = document.createElementNS(NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if (parent) parent.appendChild(e); return e; }
  function create(host) {
    const svg = el('svg', { viewBox: '0 0 256 256', width: '100%', height: '100%' }, host);
    const defs = el('defs', {}, svg);
    const cp = el('clipPath', { id: 'ldClip' }, defs); el('rect', { x: 0, y: 0, width: 256, height: 150 }, cp);
    const card = el('rect', { x: 0, y: 0, width: 256, height: 256, rx: 56, fill: W }, svg);
    const disc = el('circle', { cx: 128, cy: 128, r: 104, fill: N }, svg);
    const sunG = el('g', { 'clip-path': 'url(#ldClip)' }, svg);
    const sun = el('path', { d: 'M82 150a46 46 0 0 1 92 0z', fill: R }, sunG);
    const rays = WIDTHS.map((w, i) => {
      const a = Math.PI * (1 + (i + .5) / 9);
      return { a, w, e: el('line', { stroke: W, 'stroke-width': w, 'stroke-linecap': 'butt', opacity: 0 }, svg) };
    });
    const lines = [[60, 168, 136], [72, 188, 112], [88, 208, 80]].map(([x, y, len]) => ({ x, y, len, e: el('line', { y1: y, y2: y, stroke: W, 'stroke-width': 7, 'stroke-linecap': 'round', opacity: 0 }, svg) }));
    const scan = el('rect', { x: 0, y: 70, width: 4, height: 86, rx: 2, fill: R, opacity: 0 }, svg);
    function render(t) {                       // t بالثواني
      const k = back(t / .6);
      card.setAttribute('transform', `translate(128 128) scale(${0.82 + 0.18 * clamp(k)}) translate(-128 -128)`);
      disc.setAttribute('r', Math.max(0, 104 * Math.min(1.04, back((t - .1) / .6))));
      sun.setAttribute('transform', `translate(0 ${(1 - ease((t - .5) / .8)) * 52})`);
      const sweep = t > 2.0 ? ((t - 2.0) % 1.5) / 1.5 : -1;          // مسح متكرر
      const sx = 40 + (sweep < 0 ? 0 : sweep) * 176;
      rays.forEach((r, i) => {
        const p = ease((t - (1.0 + i * .07)) / .45);
        const r1 = 56, r2 = 56 + 40 * p, cx = 128, cy = 150;
        let boost = 0;
        if (sweep >= 0) { const x = cx + Math.cos(r.a) * 76; boost = Math.max(0, 1 - Math.abs(x - sx) / 30); }
        const rr = r2 + boost * 8;
        r.e.setAttribute('x1', cx + r1 * Math.cos(r.a)); r.e.setAttribute('y1', cy + r1 * Math.sin(r.a));
        r.e.setAttribute('x2', cx + rr * Math.cos(r.a)); r.e.setAttribute('y2', cy + rr * Math.sin(r.a));
        r.e.setAttribute('stroke', boost > .35 ? R : W);
        r.e.setAttribute('opacity', p > 0 ? 1 : 0);
      });
      lines.forEach((l, i) => {
        const p = ease((t - (.9 + i * .12)) / .5);
        const c = 128; l.e.setAttribute('x1', c - l.len / 2 * p); l.e.setAttribute('x2', c + l.len / 2 * p);
        l.e.setAttribute('opacity', p > 0 ? 1 : 0);
      });
      scan.setAttribute('x', sx - 2); scan.setAttribute('opacity', sweep >= 0 ? 0.9 * Math.sin(Math.PI * sweep) : 0);
    }
    return { render };
  }
  function start(host) {
    const a = create(host), t0 = performance.now();
    let on = true;
    (function loop() { if (!on) return; a.render((performance.now() - t0) / 1000); requestAnimationFrame(loop); })();
    return { stop() { on = false; }, render: a.render };
  }
  g.JardLoader = { create, start };
})(window);
