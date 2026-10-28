/* واجهة التطبيق الأوفلاين. كل البيانات محلية (IndexedDB) عبر Inv.createStore() */
const $ = id => document.getElementById(id);
const store = Inv.createStore();
const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
const mf = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pf = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });
const taxTxt = t => (t === null || t === undefined ? 'ضريبة غير محددة' : 'ضريبة ' + t + '%');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ---------- الشريط العلوي ---------- */
let barShown = 0;
function updateBar() {
  const s = store.stats();
  const pct = s.products ? Math.min(100, Math.round(s.items / s.products * 100)) : 0;
  $('barSub').textContent = `من ${nf.format(s.products)} صنف`;
  $('barPct').textContent = pct + '%';
  $('barRing').style.strokeDashoffset = String(113.1 * (1 - pct / 100));
  const from = barShown, to = s.items, t0 = performance.now();
  barShown = to;
  const step = now => {
    const k = Math.min(1, (now - t0) / 600), e = 1 - Math.pow(1 - k, 3);
    $('barNum').textContent = nf.format(Math.round(from + (to - from) * e));
    if (k < 1) requestAnimationFrame(step);
  };
  if (from !== to) { $('barNum').classList.remove('pulse'); void $('barNum').offsetWidth; $('barNum').classList.add('pulse'); requestAnimationFrame(step); }
  else $('barNum').textContent = nf.format(to);
}

/* ---------- نافذة التأكيد ---------- */
function askConfirm(msg, yes, alt) {
  return new Promise(res => {
    $('cfMsg').textContent = msg;
    $('cfYes').innerHTML = '<svg class="ic"><use href="#i-check"/></svg>' + (yes || 'تأكيد');
    $('cfAlt').hidden = !alt; $('cfAlt').textContent = alt || '';
    $('confirm').hidden = false;
    const done = v => { $('confirm').hidden = true; $('cfYes').onclick = $('cfNo').onclick = $('cfAlt').onclick = null; res(v); };
    $('cfYes').onclick = () => done(true); $('cfNo').onclick = () => done(false); $('cfAlt').onclick = () => done('alt');
  });
}

/* ---------- الأصوات والمؤثرات ---------- */
const FX = {
  on: true, ctx: null,
  tone(freq, dur, when, type, vol) {
    if (!this.on) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      this.ctx = this.ctx || new AC();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const t = this.ctx.currentTime + (when || 0), o = this.ctx.createOscillator(), g = this.ctx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol || 0.12, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.ctx.destination); o.start(t); o.stop(t + dur + 0.02);
    } catch (e) {}
  },
  tap() { this.tone(720, 0.05, 0, 'sine', 0.09); },
  tab() { this.tone(520, 0.06, 0, 'triangle', 0.1); this.tone(780, 0.07, 0.05, 'triangle', 0.08); },
  ok() { this.tone(660, 0.09, 0, 'sine', 0.12); this.tone(990, 0.14, 0.09, 'sine', 0.12); },
  err() { this.tone(220, 0.16, 0, 'square', 0.07); this.tone(165, 0.2, 0.12, 'square', 0.07); },
  buzz(ms) { if (this.on && navigator.vibrate) navigator.vibrate(ms); },
};
document.addEventListener('click', ev => {
  const b = ev.target.closest('button, .filebtn, .result');
  if (!b || b.disabled) return;
  if (b.closest('#nav')) { FX.tab(); FX.buzz(12); }
  else if (b.id === 'addBtn' || b.id === 'edSave') { /* صوت النجاح عبر الإشعار */ }
  else { FX.tap(); FX.buzz(8); }
  // تموّج الضغط
  const r = b.getBoundingClientRect();
  if (r.width && r.width < 700 && !b.classList.contains('result')) {
    const d = document.createElement('span'); d.className = 'ripple';
    const sz = Math.max(r.width, r.height) * 1.6;
    d.style.cssText = `width:${sz}px;height:${sz}px;left:${ev.clientX - r.left - sz / 2}px;top:${ev.clientY - r.top - sz / 2}px`;
    if (getComputedStyle(b).position === 'static') b.style.position = 'relative';
    b.style.overflow = 'hidden'; b.appendChild(d); setTimeout(() => d.remove(), 600);
  }
}, true);

function toast(msg, kind) {
  if (kind === 'ok') { FX.ok(); FX.buzz(25); } else if (kind === 'err') { FX.err(); FX.buzz([40, 40, 40]); }
  const box = $('toast');
  const el = document.createElement('div');
  if (kind) el.className = kind;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 4000 : 2200);
}

const counter = () => store.getMeta('deviceName', '') || 'هذا الجهاز';
const stocktakeName = () => store.getMeta('stocktakeName', 'جرد ' + new Date().getFullYear());
let current = null;
let queue = Promise.resolve();
const enqueue = fn => (queue = queue.then(fn).catch(e => toast(e.message || 'خطأ', 'err')));

/* ---------- الإقلاع ---------- */
const LOAD_STEPS = ['جارٍ تحميل الأصناف…', 'جارٍ تجهيز الباركود والأسعار…', 'جارٍ تجهيز الضرائب والتقارير…', 'اكتمل التحميل'];
let ldAnim = null;
async function boot() {
  const t0 = Date.now();
  if (window.JardLoader && $('ldLogo')) ldAnim = JardLoader.start($('ldLogo'));
  LOAD_STEPS.forEach((t, i) => setTimeout(() => { $('ldText').textContent = t; }, i * 1100));
  try {
    await store.init();
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  } catch (e) {
    document.querySelector('main').innerHTML = '<div class="card warn">تعذّر فتح مخزن البيانات على هذا الجهاز: ' + esc(e.message) + '</div>';
    $('loading').hidden = true;
    return;
  }
  if (store.getMeta('priceIncludesTax', false) !== true) await store.setMeta('priceIncludesTax', true);   // أسعار الشراء شاملة الضريبة دائماً
  applyFont(store.getMeta('fontSize', 19)); moveNavInd(true); if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => moveNavInd(true)); applyTheme(store.getMeta('theme', 'light')); markTheme();
  FX.on = store.getMeta('sound', true) !== false;
  refreshHeader();
  showTab('count'); updateBar(); renderFav();
  await new Promise(r => setTimeout(r, Math.max(0, 4000 - (Date.now() - t0))));
  $('loading').classList.add('out');
  setTimeout(() => { $('loading').hidden = true; if (ldAnim) ldAnim.stop(); }, 450);
}

function refreshHeader() {
  $('nameCard').hidden = !!store.getMeta('deviceName', '');
  $('noProducts').hidden = store.productCount > 0;
}

function sha256(str) {
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const b = new TextEncoder().encode(str), l = b.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n);
  m.set(b); m[l] = 0x80;
  const dv = new DataView(m.buffer); dv.setUint32(n - 4, l * 8 >>> 0); dv.setUint32(n - 8, Math.floor(l * 8 / 4294967296));
  let h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const r = (x, k) => (x >>> k) | (x << (32 - k)), w = new Array(64);
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) { const s0 = r(w[i-15],7) ^ r(w[i-15],18) ^ (w[i-15] >>> 3), s1 = r(w[i-2],17) ^ r(w[i-2],19) ^ (w[i-2] >>> 10); w[i] = (w[i-16] + s0 + w[i-7] + s1) | 0; }
    let [a, b2, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = r(e,6) ^ r(e,11) ^ r(e,25), ch = (e & f) ^ (~e & g), t1 = (hh + S1 + ch + K[i] + w[i]) | 0;
      const S0 = r(a,2) ^ r(a,13) ^ r(a,22), mj = (a & b2) ^ (a & c) ^ (b2 & c), t2 = (S0 + mj) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b2; b2 = a; a = (t1 + t2) | 0;
    }
    h = [h[0]+a|0, h[1]+b2|0, h[2]+c|0, h[3]+d|0, h[4]+e|0, h[5]+f|0, h[6]+g|0, h[7]+hh|0];
  }
  return h.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
}
const LOCK_HASH = '5bfea5d2c912aedf3cdb15ab1fec265f40eddc70ee21e5961c160cd78d54422f';
let unlocked = false;
function askPassword() {
  return new Promise(res => {
    $('lockInput').value = ''; $('lock').hidden = false; setTimeout(() => $('lockInput').focus(), 50);
    const done = v => { $('lock').hidden = true; $('lockForm').onsubmit = $('lockNo').onclick = null; res(v); };
    $('lockNo').onclick = () => done(false);
    $('lockForm').onsubmit = ev => {
      ev.preventDefault();
      if (sha256('jard26|' + $('lockInput').value) === LOCK_HASH) { unlocked = true; FX.ok(); done(true); }
      else { toast('كلمة السر غير صحيحة', 'err'); const b = document.querySelector('#lock .cf-box'); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); $('lockInput').select(); }
    };
  });
}

/* ---------- التبويبات ---------- */
const TAB_ORDER = ['count', 'report', 'products', 'reports', 'settings'];
let curTab = 'count';
function moveNavInd(instant) {
  const ind = $('navInd'), b = document.querySelector('#nav button.on'); if (!ind || !b) return;
  if (instant) ind.classList.add('nt');
  ind.style.width = b.offsetWidth + 'px'; ind.style.transform = `translateX(${b.offsetLeft}px)`;
  if (instant) requestAnimationFrame(() => requestAnimationFrame(() => ind.classList.remove('nt')));
}
window.addEventListener('resize', () => moveNavInd(true));
function showTab(tab) {
  document.documentElement.style.setProperty('--dir', TAB_ORDER.indexOf(tab) > TAB_ORDER.indexOf(curTab) ? -1 : (TAB_ORDER.indexOf(tab) < TAB_ORDER.indexOf(curTab) ? 1 : 0));
  curTab = tab;
  if (tab !== 'settings') unlocked = false;   // الإعدادات تُقفل عند مغادرتها
  document.querySelector('.bar').classList.toggle('mini', tab !== 'count');
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  ['count', 'report', 'products', 'reports', 'settings'].forEach(t => { $('tab-' + t).hidden = t !== tab; });
  moveNavInd(false);
  if (tab !== 'count') stopScanner();
  if (tab === 'count') { refreshHeader(); loadRecent(); }
  if (tab === 'report') { renderStats(); loadRecent(); }
  if (tab === 'products') { $('cePanel').hidden = true; loadCe(); loadReport(false); $('pCount').textContent = nf.format(store.productCount); updateBulk(); }
  if (tab === 'settings') { $('pCount').textContent = nf.format(store.productCount); $('setName').value = store.getMeta('deviceName', ''); $('setStocktake').value = stocktakeName(); $('setCompany').value = store.getMeta('companyName', 'أنوار طيبة للتموين'); markFont(); markSound(); markTheme(); }
}
$('nav').addEventListener('click', async ev => {
  const b = ev.target.closest('button'); if (!b) return;
  if (b.dataset.tab === 'settings' && !unlocked && !(await askPassword())) return;
  showTab(b.dataset.tab);
});

/* ---------- الاسم ---------- */
$('nameSave').addEventListener('click', async () => {
  const v = $('nameInput').value.trim();
  if (!v) { toast('الاسم مطلوب', 'err'); return; }
  await store.setMeta('deviceName', v);
  refreshHeader();
});

/* ---------- البحث والمسح ---------- */
function hideAll() {
  $('results').hidden = true; $('product').hidden = true;
  current = null;
  renderFav();
}
function renderFav() {
  const top = store.topCounted(6, 6);
  $('favChips').innerHTML = top.map(t => `<button type="button" data-id="${t.id}">${esc(t.name)}<small>${nf.format(t.times)}×</small></button>`).join('');
  favVis(top.length > 0);
}
function favVis(has) {
  if (has === undefined) has = $('favChips').children.length > 0;
  $('fav').hidden = !has || !$('results').hidden || !$('product').hidden;
}
$('favChips').addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  const p = store.getProduct(+b.dataset.id); if (p) selectProduct(p);
});

async function doLookup(text, scanned) {
  text = text.trim();
  if (!text) return null;
  const { items, total } = store.lookupAll(text, 200);
  hideAll();
  if (!items.length) { showNotFound(text); return 'notfound'; }
  text = text.replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660));
  const digits = text.replace(/^0+/, '');
  const exact = (/^\d{6,}$/.test(text) || (scanned && /^\d+$/.test(text))) && items[0].barcode && items[0].barcode.replace(/^0+/, '') === digits ? items[0] : null;
  if (exact) {
    selectProduct(exact);
    return 'selected';
  }
  if (items.length === 1 && scanned) { selectProduct(items[0]); return 'selected'; }   // Enter على نتيجة وحيدة
  renderResults(items, total);
  return 'list';
}

function renderResults(items, total) {
  const box = $('results');
  const price = p => pf.format(p.priceGross);
  box.innerHTML = `<div class="info">${nf.format(total)} صنف مطابق${total > items.length ? ' (عرض أول ' + items.length + ')' : ''}</div>` +
    items.map((p, i) =>
    `<button type="button" class="result" data-i="${i}">
       <span>${esc(p.name)}<small>${esc(p.barcode || 'بدون باركود')} · ${esc(p.unit)} · ${price(p)}
         <span class="tg ${p.tax === null ? 'none' : ''}">${p.tax === null ? 'بدون ضريبة محددة' : p.tax + '%'}</span></small></span>
       <span class="cnt">${p.counted ? nf.format(p.counted) : ''}</span>
     </button>`).join('');
  box._items = items;
  box.hidden = false; favVis();
}
$('results').addEventListener('click', ev => {
  const b = ev.target.closest('.result');
  if (b) selectProduct($('results')._items[+b.dataset.i]);
});

function renderProductInfo() {
  const p = current;
  $('pName').textContent = p.name;
  $('pMeta').textContent = (p.barcode || 'بدون باركود') + ' · ' + p.unit +
    (p.counted ? ' · المعدود حتى الآن: ' + nf.format(p.counted) : '');
  $('pPrice').textContent = `السعر ${pf.format(p.priceGross)} شامل الضريبة · ${taxTxt(p.tax)}`;
}

function selectProduct(p) {
  hideAll();
  current = p;
  renderProductInfo();
  fillEdit();
  $('qty').value = '';
  $('product').hidden = false; favVis(); setTimeout(updateReady, 0);
  $('prevNote').hidden = !(p.counted > 0);
  $('prevNote').textContent = p.counted > 0 ? `معدود سابقاً: ${nf.format(p.counted)} ${p.unit}` : '';
  $('edPrice').blur();
}

const UNITS = ['حبة', 'كيلو', 'غرام'];
function renderUnits(box, cur) {
  const list = UNITS.includes(cur) ? UNITS : [cur, ...UNITS];
  box.innerHTML = list.map(u => `<button type="button" data-u="${esc(u)}" class="${u === cur ? 'on' : ''}">${esc(u)}</button>`).join('');
}
const unitOf = box => { const b = box.querySelector('button.on'); return b ? b.dataset.u : null; };
function pickUnit(box, ev) { const b = ev.target.closest('button'); if (!b) return false; box.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); return true; }
const TAX_CHIPS = [['0', '0%'], ['1', '1%'], ['2', '2%'], ['4', '4%'], ['5', '5%'], ['10', '10%'], ['16', '16%']];
$('edChips').innerHTML = TAX_CHIPS.map(([v, t]) => `<button type="button" data-v="${v}">${t}</button>`).join('');
function markChips() { document.querySelectorAll('#edChips button').forEach(b => b.classList.toggle('on', b.dataset.v === $('edTax').value)); }
$('edChips').addEventListener('click', async ev => {
  const b = ev.target.closest('button'); if (!b) return;
  $('edTax').value = b.dataset.v; markChips();
  await saveEdit();
  showStep(true); setTimeout(() => $('qty').focus({ preventScroll: false }), 80);
  updateReady();
});
$('edUnits').addEventListener('click', ev => { if (pickUnit($('edUnits'), ev)) { $('qty').placeholder = 'الكمية (' + unitOf($('edUnits')) + ')'; saveEdit(); } });
function showStep(second) {
  $('step1').hidden = second; $('step2').hidden = !second;
  if (second) {
    const u = unitOf($('edUnits')) || current.unit;
    $('sumTxt').textContent = `السعر ${current.cost > 0 ? pf.format(current.cost) : '—'} · ${taxTxt(current.tax)} · ${u}`;
    $('qty').placeholder = 'الكمية (' + u + ')';
  }
}
$('editPT').addEventListener('click', () => { showStep(false); updateReady(); });
function fillEdit() {
  renderUnits($('edUnits'), current.unit); $('qty').placeholder = 'الكمية (' + current.unit + ')';
  $('edPriceLbl').textContent = 'سعر الشراء للوحدة (شامل الضريبة)';
  $('edPrice').value = current.cost > 0 ? String(current.cost) : '';
  $('edPrice').placeholder = 'السعر';
  $('edTax').innerHTML = '<option value=""></option>' + TAX_CHIPS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
  $('edTax').value = current.tax == null ? '' : String(current.tax);
  $('savedMark').textContent = '';
  markChips();
  showStep(current.tax != null);
}
let savingEdit = Promise.resolve();
function saveEdit() {
  if (!current) return savingEdit;
  const price = $('edPrice').value.trim();
  const taxV = $('edTax').value === '' ? current.tax : Number($('edTax').value);
  const cost = price === '' || isNaN(parseFloat(price)) ? current.cost : parseFloat(price);
  const unitV = unitOf($('edUnits')) || current.unit;
  if (cost === current.cost && taxV === current.tax && unitV === current.unit) return savingEdit;
  const id = current.id;
  savingEdit = savingEdit.then(async () => {
    try {
      const v = await store.updateProduct(id, { cost, tax: taxV, unit: unitV });
      if (current && current.id === id) { current = v; renderProductInfo(); }
      $('savedMark').textContent = 'تم حفظ السعر والضريبة ✓';
      FX.tab();
    } catch (e) { toast(e.message, 'err'); }
  });
  return savingEdit;
}
$('edPrice').addEventListener('change', saveEdit);
$('edPrice').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); saveEdit(); $('edPrice').blur(); } });

function showNotFound() {
  hideAll();
  const box = $('toast'), el = document.createElement('div');
  el.className = 'err'; el.textContent = 'هذا الصنف غير موجود';
  FX.err(); FX.buzz([40, 40, 40]);
  box.appendChild(el); setTimeout(() => el.remove(), 2000);
  $('q').focus(); $('q').select();
}

$('searchForm').addEventListener('submit', ev => {
  ev.preventDefault();
  const t = $('q').value;
  enqueue(() => doLookup(t, true));
});
$('q').addEventListener('input', debounce(() => {
  const t = $('q').value.trim();
  if (!t) { hideAll(); return; }
  // باركود طويل (6 أرقام فأكثر) ننتظر Enter؛ الأرقام القصيرة والنص بحث مباشر
  const num = t.replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660));
  if (/^\d{6,}$/.test(num)) return;
  if (t.length >= 2 || /^\d$/.test(num)) enqueue(() => doLookup(t, false));
}, 250));

/* ---------- الكمية والإضافة ---------- */
const qtyVal = () => parseFloat($('qty').value) || 0;
$('plus').addEventListener('click', () => { $('qty').value = +(qtyVal() + 1).toFixed(3); });
$('minus').addEventListener('click', () => { $('qty').value = Math.max(0, +(qtyVal() - 1).toFixed(3)); });
document.querySelectorAll('.chips button').forEach(b =>
  b.addEventListener('click', () => { $('qty').value = +(qtyVal() + +b.dataset.add).toFixed(3); }));
$('qty').addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); addCurrent(); } });
$('addBtn').addEventListener('click', addCurrent);
$('cancelBtn').addEventListener('click', () => { hideAll(); $('q').value = ''; $('q').focus(); });

function updateReady() {
  const ok = !!current && $('edTax').value !== '' && qtyVal() > 0;
  $('addBtn').classList.toggle('ready', ok);
}
['input', 'change'].forEach(ev => $('qty').addEventListener(ev, updateReady));
$('edChips').addEventListener('click', () => setTimeout(updateReady, 0));
document.querySelectorAll('.chips button, #plus, #minus').forEach(b => b.addEventListener('click', () => setTimeout(updateReady, 0)));
let adding = false;
function okPop() { const e = $('okPop'); e.classList.remove('go'); void e.offsetWidth; e.classList.add('go'); }
async function addCurrent() {
  if (!current || adding) return;
  const qty = qtyVal();
  if ($('edTax').value === '') {
    toast('اختر نسبة الضريبة للصنف قبل الإضافة للجرد', 'err');
    const c = $('edChips'); c.classList.remove('need'); void c.offsetWidth; c.classList.add('need');
    c.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  if (qty <= 0) { toast('أدخل الكمية', 'err'); $('qty').focus(); return; }
  adding = true;
  $('addBtn').disabled = true;
  try {
    const cp = current;
    // كمية غير معقولة
    const sys = cp.system;
    if (qty >= 1000 || (sys !== null && sys >= 0 && qty > sys * 3 + 20)) {
      const why = qty >= 1000 ? 'تبدو كبيرة جداً' : `أكبر بكثير من الكمية الدفترية (${nf.format(sys)})`;
      if (!(await askConfirm(`الكمية ${nf.format(qty)} ${cp.unit} ${why}.\nهل هي صحيحة؟`, 'نعم، صحيحة'))) { adding = false; $('addBtn').disabled = false; $('qty').focus(); $('qty').select(); return; }
    }
    // صنف معدود سابقاً
    let replace = false;
    if (cp.counted > 0) {
      const ch = await askConfirm(`هذا الصنف معدود سابقاً: ${nf.format(cp.counted)} ${cp.unit}.\nالكمية الجديدة: ${nf.format(qty)}`, `إضافة (المجموع ${nf.format(Math.round((cp.counted + qty) * 1000) / 1000)})`);
      if (ch === false) { adding = false; $('addBtn').disabled = false; return; }
      replace = false;
    }
    await saveEdit();
    const p = current;
    let r;
    if (replace) { r = { counted: await store.setOwnCount(p.id, qty, counter()) }; }
    else r = await store.addCount(p.id, qty, counter());
    toast(`${replace ? 'تم استبدال الكمية' : 'تمت إضافة ' + nf.format(qty)} — المجموع ${nf.format(r.counted)} ${p.unit}`, 'ok');
    hideAll(); okPop();
    $('q').value = '';
    $('q').focus();
    loadRecent(); renderFav(); updateBar();
  } catch (e) { toast(e.message, 'err'); }
  finally { adding = false; $('addBtn').disabled = false; }
}

/* ---------- آخر ما سجّلته ---------- */
const hhmm = ts => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const recentRow = r => `<li><div class="grow">${esc(r.name)}<small>${hhmm(r.ts)}</small></div>
       <div class="q">${nf.format(r.qty)} ${esc(r.unit)}</div>
       <button class="x" data-id="${r.id}" data-name="${esc(r.name)}" data-q="${nf.format(r.qty)} ${esc(r.unit)}" aria-label="إلغاء"><svg class="ic"><use href="#i-x"/></svg></button></li>`;
function loadRecent() {
  updateBar();
  const items = store.recent(30);
  $('recentEmpty').hidden = items.length > 0;
  $('recent').innerHTML = items.slice(0, 2).map(recentRow).join('');
  $('recentMore').innerHTML = items.slice(2).map(recentRow).join('');
  const more = items.length > 2;
  $('recentToggle').hidden = !more;
  if (!more) { $('recentMore').hidden = true; $('recentToggle').classList.remove('open'); }
  $('recentToggleTxt').textContent = $('recentMore').hidden ? `عرض الباقي (${items.length - 2})` : 'إخفاء';
}
$('recentToggle').addEventListener('click', () => {
  const open = $('recentMore').hidden;
  $('recentMore').hidden = !open;
  $('recentToggle').classList.toggle('open', open);
  loadRecent();
});
async function onRecentClick(ev) {
  const b = ev.target.closest('.x');
  if (!b) return;
  if (!(await askConfirm(`إلغاء هذا العدّ؟\n${b.dataset.name} — ${b.dataset.q}`, 'نعم، إلغاء'))) return;
  try { await store.undoCount(+b.dataset.id); toast('تم الإلغاء'); loadRecent(); renderStats(); loadReport(false); }
  catch (e) { toast(e.message, 'err'); }
}
$('recent').addEventListener('click', onRecentClick);
$('recentMore').addEventListener('click', onRecentClick);

/* ---------- ماسح الكاميرا (ZXing) ---------- */
let scan = null, lastCode = '', lastAt = 0;
const SCAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];

async function openScanner() {
  if (scan) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('الكاميرا غير متاحة على هذا الجهاز', 'err'); return; }
  $('scanner').hidden = false;
  const st = scan = { stop: false, stream: null, timer: 0, detector: null, zx: null };
  try {
    st.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
    });
    if (st.stop) { st.stream.getTracks().forEach(t => t.stop()); return; }
    const track = st.stream.getVideoTracks()[0];
    const caps = (track.getCapabilities && track.getCapabilities()) || {};
    if (caps.focusMode && caps.focusMode.includes('continuous')) { try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch (e) {} }
    $('torchBtn').hidden = !caps.torch; $('torchBtn').classList.remove('on');
    st.track = track;
    const v = $('video'); v.srcObject = st.stream; v.setAttribute('playsinline', ''); v.muted = true;
    await v.play();
    if ('BarcodeDetector' in window) {
      try { st.detector = new BarcodeDetector({ formats: SCAN_FORMATS }); } catch (e) { st.detector = null; }
    }
    if (!st.detector && window.ZXing) {
      const hints = new Map();
      const F = ZXing.BarcodeFormat;
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF]);
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      st.zx = new ZXing.MultiFormatReader(); st.zx.setHints(hints);
    }
    if (!st.detector && !st.zx) throw new Error('no decoder');
    st.canvas = document.createElement('canvas');
    let n = 0;
    const tick = async () => {
      if (st.stop) return;
      let code = '';
      try { code = await scanFrame(st, v, n++); } catch (e) {}
      if (st.stop) return;
      if (code) {
        const now = Date.now(), same = code === lastCode && now - lastAt < 2500;
        lastCode = code; lastAt = now;
        if (!same) { onScanned(code); return; }
      }
      st.timer = setTimeout(tick, 90);
    };
    tick();
  } catch (e) {
    stopScanner();
    toast(e && /Permission|NotAllowed|Denied/i.test(e.name + e.message) ? 'لم يُمنح التطبيق إذن الكاميرا. فعّله من إعدادات الهاتف.' : 'تعذّر فتح الكاميرا.', 'err');
  }
}

async function scanFrame(st, v, n) {
  if (!v.videoWidth) return '';
  if (st.detector) {
    const r = await st.detector.detect(v);
    return r && r.length ? r[0].rawValue : '';
  }
  // ZXing: نقرأ شريحة من منتصف الصورة بدقة عالية، ونبدّل أحياناً إلى الصورة كاملة
  const vw = v.videoWidth, vh = v.videoHeight, c = st.canvas;
  let sx = 0, sy = 0, sw = vw, sh = vh;
  if (n % 3 !== 2) { sh = Math.round(vh * 0.45); sy = Math.round((vh - sh) / 2); }
  const scale = Math.min(1, 1280 / sw);
  c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
  c.getContext('2d', { willReadFrequently: true }).drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
  try {
    const bmp = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(new ZXing.HTMLCanvasElementLuminanceSource(c)));
    return st.zx.decode(bmp).getText();
  } catch (e) { return ''; }
}

function stopScanner() {
  const st = scan; scan = null;
  if (st) {
    st.stop = true; clearTimeout(st.timer);
    if (st.stream) st.stream.getTracks().forEach(t => { try { t.stop(); } catch (e) {} });
  }
  try { $('video').srcObject = null; } catch (e) {}
  $('scanner').hidden = true;
}

$('torchBtn').addEventListener('click', async () => {
  if (!scan || !scan.track) return;
  const on = !$('torchBtn').classList.contains('on');
  try { await scan.track.applyConstraints({ advanced: [{ torch: on }] }); $('torchBtn').classList.toggle('on', on); } catch (e) {}
});

function onScanned(code) {
  if (navigator.vibrate) navigator.vibrate(60);
  stopScanner();
  $('q').value = code;
  enqueue(() => doLookup(code, true));
}
$('scanBtn').addEventListener('click', openScanner);
$('scanClose').addEventListener('click', stopScanner);

/* ---------- النتائج ---------- */
function renderStats() {
  const s = store.stats();
  const pct = s.products ? Math.min(100, Math.round(s.items / s.products * 100)) : 0;
  $('pct').textContent = pct;
  $('bar').style.width = pct + '%';
  $('items').textContent = nf.format(s.items);
  $('products').textContent = nf.format(s.products);
  $('entries').textContent = nf.format(s.entries);
  $('diffs').textContent = nf.format(s.diffs);
  $('short').textContent = mf.format(s.short); $('shortG').textContent = mf.format(s.shortG);
  $('surplus').textContent = mf.format(s.surplus); $('surplusG').textContent = mf.format(s.surplusG);
  const hasBook = s.withBook > 0;
  document.querySelectorAll('[data-book]').forEach(el => { el.hidden = !hasBook; });
  if (!hasBook && $('fFilter').value === 'diff') $('fFilter').value = 'all';
}

let reportOffset = 0;
function loadReport(append) {
  if (!append) reportOffset = 0;
  const r = store.report($('fFilter').value, $('fQ').value, reportOffset, 100, $('fTax').value);
  const html = r.rows.map(x => {
    const d = x.diff;
    const diff = x.uncounted ? 'لم يُعدّ'
      : d === null ? `<b>${mf.format(x.amount)}</b>`
      : d === 0 ? 'مطابق'
      : `<b class="${d < 0 ? 'neg' : 'pos'}">${d > 0 ? '+' : ''}${nf.format(d)}</b>`;
    const line = (x.system === null ? '' : `دفتري ${nf.format(x.system)} · `) + `معدود ${x.uncounted ? '—' : nf.format(x.counted)}`;
    const val = !x.uncounted ? `<span>${mf.format(x.amount)} قبل الضريبة</span><span>${mf.format(x.amountG)} بعد الضريبة</span>` : '';
    return `<div class="rrow ${x.uncounted ? 'unc' : ''}">
      <div class="grow">${esc(x.name)}<small>${esc(x.barcode || 'بدون باركود')} · ${esc(x.unit)} · ${x.tax === null ? 'ضريبة غير محددة' : 'ضريبة ' + x.tax + '%'}</small></div>
      <div class="nums"><span>${line}</span>${diff}${val}</div>
    </div>`;
  }).join('');
  $('rows').innerHTML = append ? $('rows').innerHTML + html : html;
  $('fTotal').textContent = nf.format(r.total) + ' صنف';
  $('more').hidden = !r.hasMore;
  reportOffset += r.rows.length;
}
$('fFilter').addEventListener('change', () => loadReport(false));
$('fTax').addEventListener('change', () => loadReport(false));
$('fQ').addEventListener('input', debounce(() => loadReport(false), 250));
$('more').addEventListener('click', () => loadReport(true));

/* ---------- تصدير ودمج ---------- */
function downloadBlob(name, text) {
  const url = URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

$('exportBtn').addEventListener('click', async () => {
  if (!store.getMeta('deviceName', '')) {
    toast('يلزم تحديد اسم الجهاز في الإعدادات أولاً', 'err');
    return;
  }
  const day = new Date().toISOString().slice(0, 10);
  const who = (store.getMeta('deviceName', '') || 'device').replace(/[^\p{L}\p{N}_-]+/gu, '_');
  const name = `jard-${who}-${day}.csv`;
  const text = store.exportCsv();
  try {
    if (window.NativeFiles && NativeFiles.isNative()) await NativeFiles.save(name, text);
    else downloadBlob(name, text);
  } catch (e) {
    if (!/cancel/i.test(String(e && e.message))) toast('تعذّر التصدير: ' + (e.message || e), 'err');
  }
});

$('mergeBtn').addEventListener('click', async () => {
  const files = [...$('mergeFiles').files];
  if (!files.length) { toast('لم يُختر أي ملف', 'err'); return; }
  const out = [];
  for (const f of files) {
    try {
      const text = Inv.csv.decodeBuffer(await f.arrayBuffer());
      const fallback = f.name.replace(/\.[^.]+$/, '').replace(/^jard-/, '');
      const r = await store.mergeCsv(text, fallback);
      out.push(`✓ جهاز «${r.label}»: دُمج ${nf.format(r.merged)} صنف` + (r.created ? ` (منها ${r.created} صنف جديد)` : '') + (r.taxes ? ` — حُدّدت ضريبة ${r.taxes} صنف` : '') +
        (r.replaced ? ' — استبدل الدمج السابق من نفس الجهاز' : ''));
    } catch (e) {
      out.push(`✗ ${f.name}: ${e.message}`);
    }
  }
  $('mergeRes').textContent = out.join('\n');
  $('mergeFiles').value = ''; $('mergeFileName').textContent = 'لم يُختر أي ملف';
  renderStats(); loadReport(false); refreshHeader();
});


/* ---------- ملف تعريف الضرائب ---------- */
$('tdExport').addEventListener('click', async () => {
  const { text, count } = store.exportTaxDefsCsv();
  if (!count) { toast('لا توجد أصناف محدّدة الضريبة لإصدارها', 'err'); return; }
  const day = new Date().toISOString().slice(0, 10);
  const name = `jard-tax-${day}.csv`;
  try {
    if (window.NativeFiles && NativeFiles.isNative()) await NativeFiles.save(name, text);
    else downloadBlob(name, text);
    toast(`أُصدر ملف تعريف الضرائب (${nf.format(count)} صنف)`, 'ok');
  } catch (e) {
    if (!/cancel/i.test(String(e && e.message))) toast('تعذّر الإصدار: ' + (e.message || e), 'err');
  }
});
$('tdFile').addEventListener('change', () => { const f = $('tdFile').files[0]; $('tdFileName').textContent = f ? f.name : 'لم يُختر أي ملف'; });
$('tdImport').addEventListener('click', async () => {
  const f = $('tdFile').files[0];
  if (!f) { toast('لم يُختر أي ملف', 'err'); return; }
  try {
    const r = await store.importTaxDefs(Inv.csv.decodeBuffer(await f.arrayBuffer()));
    $('tdRes').textContent = `✓ عُرّفت ضريبة ${nf.format(r.total)} صنف` + (r.taxes ? ` (تغيّرت نسبة ${nf.format(r.taxes)} منها)` : '') +
      (r.prices ? `\nأُضيف سعر ${nf.format(r.prices)} صنف كان بلا سعر` : '') +
      (r.missing ? `\nلم يُعثر على ${nf.format(r.missing)} صنف في هذا الجهاز` : '') +
      (r.invalid ? `\nتُجوهل ${nf.format(r.invalid)} سطر بنسبة ضريبة غير صحيحة` : '');
    toast('تم استيراد نسب الضريبة', 'ok');
    $('tdFile').value = ''; $('tdFileName').textContent = 'لم يُختر أي ملف';
    renderStats(); loadReport(false); refreshHeader();
  } catch (e) { $('tdRes').textContent = '✗ ' + e.message; toast(e.message, 'err'); }
});

/* ---------- الأصناف ---------- */
function showImport(r) {
  let t = `تم: ${nf.format(r.inserted)} صنف جديد، ${nf.format(r.updated)} محدّث، ${nf.format(r.skipped)} متجاهَل.`;
  if (r.duplicates) t += `\n${nf.format(r.duplicates)} صنف باركوده مكرر بالملف (أُضيفت بدون باركود ويمكن البحث عنها بالاسم).`;
  if (r.errors.length) t += '\n' + r.errors.join('\n');
  $('importRes').textContent = t;
  $('pCount').textContent = nf.format(store.productCount);
  refreshHeader();
}

let xlsxLoading = null;
function loadXlsx() {
  if (window.XLSX) return Promise.resolve();
  if (!xlsxLoading) {
    xlsxLoading = new Promise((res, rej) => {
      const el = document.createElement('script');
      el.src = 'vendor/xlsx.full.min.js';
      el.onload = res;
      el.onerror = () => { xlsxLoading = null; rej(new Error('تعذّر تحميل قارئ ملفات الجداول')); };
      document.head.appendChild(el);
    });
  }
  return xlsxLoading;
}

async function readTable(file) {
  const buf = await file.arrayBuffer();
  const b = new Uint8Array(buf);
  const isXls = b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0;   // xls قديم
  const isZip = b[0] === 0x50 && b[1] === 0x4B;                                      // xlsx
  if (isXls || isZip) {
    await loadXlsx();
    const wb = XLSX.read(buf, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) throw new Error('الملف لا يحتوي على أي ورقة');
    return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
  }
  return Inv.csv.parse(Inv.csv.decodeBuffer(buf));
}

$('file').addEventListener('change', () => { $('fileName').textContent = $('file').files[0] ? $('file').files[0].name : 'لم يُختر أي ملف'; });
$('mergeFiles').addEventListener('change', () => {
  const n = $('mergeFiles').files.length;
  $('mergeFileName').textContent = n === 0 ? 'لم يُختر أي ملف' : n === 1 ? $('mergeFiles').files[0].name : `تم اختيار ${n} ملفات`;
});
$('importBtn').addEventListener('click', async () => {
  const f = $('file').files[0];
  if (!f) { toast('لم يُختر أي ملف', 'err'); return; }
  $('importBtn').disabled = true;
  $('importRes').textContent = 'جاري قراءة الملف…';
  try {
    const rows = await readTable(f);
    $('importRes').textContent = 'جاري الاستيراد (' + nf.format(rows.length) + ' سطر)…';
    await new Promise(r => setTimeout(r, 30));
    showImport(await store.importProducts(rows));
    $('file').value = ''; $('fileName').textContent = 'لم يُختر أي ملف';
  } catch (e) { $('importRes').textContent = ''; toast(e.message || 'تعذّر قراءة الملف', 'err'); }
  finally { $('importBtn').disabled = false; }
});
$('sampleBtn').addEventListener('click', async () => {
  try { showImport(await store.importProducts(Inv.sampleRows)); toast('تمت إضافة الأصناف التجريبية', 'ok'); }
  catch (e) { toast(e.message, 'err'); }
});

/* ---------- ضريبة جماعية ---------- */
function updateBulk() {
  const q = $('bulkQ').value.trim();
  const n = store.countMatching(q);
  const names = q ? store.lookupAll(q, 4).items.map(x => x.name).join('، ') : '';
  $('bulkCount').textContent = q
    ? (n ? `${nf.format(n)} صنف مطابق: ${names}${n > 4 ? '…' : ''}` : 'لا توجد أصناف مطابقة')
    : `كل الأصناف (${nf.format(n)})`;
  $('bulkBtn').disabled = n === 0;
  const unset = store.taxReport().cats.slice(-1)[0].products;
  $('taxUnset').textContent = unset ? `أصناف بدون ضريبة محددة: ${nf.format(unset)} (تُحتسب 0% في التقارير)` : 'كل الأصناف لها ضريبة محددة.';
}
$('bulkQ').addEventListener('input', debounce(updateBulk, 200));
$('bulkBtn').addEventListener('click', async () => {
  const q = $('bulkQ').value.trim();
  const n = store.countMatching(q);
  const rate = Number($('bulkTax').value);
  if (!n || !(await askConfirm(`تحديد ضريبة ${rate}% لـ ${nf.format(n)} صنف${q ? ' (مطابقة لـ «' + q + '»)' : ' (كل الأصناف)'}؟`, 'تطبيق'))) return;
  try {
    const c = await store.bulkSetTax(q, rate);
    $('bulkRes').textContent = `تم تحديد ${rate}% لـ ${nf.format(c)} صنف.`;
    updateBulk();
  } catch (e) { toast(e.message, 'err'); }
});

/* ---------- المظهر ---------- */
const darkMq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme(t) {
  const dark = t === 'dark' || (t === 'auto' && darkMq && darkMq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = dark ? '#12111f' : '#28235d';
}
function markTheme() {
  const cur = store.getMeta('theme', 'light');
  document.querySelectorAll('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.t === cur));
}
$('themeSeg').addEventListener('click', async ev => {
  const b = ev.target.closest('button'); if (!b) return;
  applyTheme(b.dataset.t); await store.setMeta('theme', b.dataset.t); markTheme();
});
if (darkMq && darkMq.addEventListener) darkMq.addEventListener('change', () => applyTheme(store.getMeta('theme', 'light')));

/* ---------- حجم الخط ---------- */
function applyFont(px) { document.documentElement.style.fontSize = (Number(px) || 19) + 'px'; }
function markFont() {
  const cur = String(Number(store.getMeta('fontSize', 19)) || 19);
  document.querySelectorAll('#fontSeg button').forEach(b => b.classList.toggle('on', b.dataset.s === cur));
}
$('fontSeg').addEventListener('click', async ev => {
  const b = ev.target.closest('button'); if (!b) return;
  applyFont(b.dataset.s);
  await store.setMeta('fontSize', Number(b.dataset.s));
  markFont();
});

function markSound() {
  document.querySelectorAll('#soundSeg button').forEach(b => b.classList.toggle('on', (b.dataset.v === '1') === FX.on));
}
$('soundSeg').addEventListener('click', async ev => {
  const b = ev.target.closest('button'); if (!b) return;
  FX.on = b.dataset.v === '1';
  await store.setMeta('sound', FX.on);
  markSound(); FX.ok();
});

/* ---------- إصدار التقارير ---------- */
const loadScript = src => new Promise((ok, no) => {
  const el = document.createElement('script'); el.src = src; el.onload = ok; el.onerror = () => no(new Error('تعذّر تحميل ' + src));
  document.head.appendChild(el);
});
let repFmt = 'xlsx';
$('repType').addEventListener('change', () => { $('repRateBox').hidden = $('repType').value !== 'tax'; });
$('repFmt').addEventListener('click', ev => {
  const b = ev.target.closest('button'); if (!b) return;
  repFmt = b.dataset.f;
  document.querySelectorAll('#repFmt button').forEach(x => x.classList.toggle('on', x === b));
});
async function saveFile(name, bytes, mime) {
  if (window.NativeFiles && NativeFiles.isNative()) { await NativeFiles.saveBinary(name, bytes); return; }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
$('repBtn').addEventListener('click', async () => {
  const btn = $('repBtn'), note = $('repNote');
  const type = $('repType').value;
  btn.disabled = true; note.textContent = 'جارٍ إعداد التقرير…';
  try {
    await loadScript('vendor/report-assets.js');
    if (repFmt === 'xlsx') { if (!window.ExcelJS) await loadScript('vendor/exceljs.min.js'); }
    else if (!window.jspdf) await loadScript('vendor/jspdf.umd.min.js');
    const pack = store.reportPack(type, { rate: $('repRate').value });
    const day = new Date().toISOString().slice(0, 10);
    const rt = type === 'tax' && $('repRate').value !== 'all' ? '-' + $('repRate').value : '';
    const base = { full: 'jard-shamel', tax: 'jard-tax' + rt, diff: 'jard-diff', uncounted: 'jard-uncounted' }[type] + '-' + day;
    if (repFmt === 'xlsx') {
      const bytes = await Inv.report.buildXlsx(pack, window.InvAssets);
      await saveFile(base + '.xlsx', bytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } else {
      const bytes = await Inv.report.buildPdf(pack, window.InvAssets, p => { note.textContent = 'جارٍ إعداد التقرير… ' + Math.round(p * 100) + '%'; });
      await saveFile(base + '.pdf', bytes, 'application/pdf');
    }
    note.textContent = '';
  } catch (e) {
    note.textContent = '';
    if (!/cancel/i.test(String(e && e.message))) toast('تعذّر إصدار التقرير: ' + (e.message || e), 'err');
  } finally { btn.disabled = false; }
});

/* ---------- تعديل الأصناف المجرودة ---------- */
let ceCur = null;
$('ceChips').innerHTML = TAX_CHIPS.map(([v, t]) => `<button type="button" data-v="${v}">${t}</button>`).join('');
let ceTax = null;
$('ceUnits').addEventListener('click', ev => pickUnit($('ceUnits'), ev));
function markCe() { document.querySelectorAll('#ceChips button').forEach(b => b.classList.toggle('on', ceTax !== null && b.dataset.v === String(ceTax))); }
$('ceChips').addEventListener('click', ev => { const b = ev.target.closest('button'); if (!b) return; ceTax = Number(b.dataset.v); markCe(); });
function loadCe() {
  const r = store.report('counted', $('ceQ').value, 0, 30);
  $('ceCount').textContent = nf.format(r.total) + ' صنف مجرود' + (r.hasMore ? ' (عرض أول 30)' : '');
  $('ceList').innerHTML = r.rows.map(x =>
    `<button type="button" class="result" data-id="${x.id}"><span>${esc(x.name)}<small>${esc(x.barcode || 'بدون باركود')} · ${esc(x.unit)} · ${x.tax === null ? 'ضريبة غير محددة' : 'ضريبة ' + x.tax + '%'}</small></span><span class="cnt">${nf.format(x.counted)}</span></button>`).join('');
}
$('ceQ').addEventListener('input', debounce(loadCe, 200));
$('ceList').addEventListener('click', ev => {
  const b = ev.target.closest('.result'); if (!b) return;
  const p = store.getProduct(+b.dataset.id); if (!p) return;
  ceCur = p;
  $('ceName').textContent = p.name;
  const merged = r3js(p.counted - store.ownCount(p.id));
  $('ceMeta').textContent = (p.barcode || 'بدون باركود') + ' · ' + p.unit + (merged > 0 ? ' · مدموج من أجهزة أخرى: ' + nf.format(merged) : '');
  $('ceQty').value = store.ownCount(p.id);
  $('cePriceLbl').textContent = 'سعر الشراء للوحدة (شامل الضريبة)';
  $('cePrice').value = p.cost;
  ceTax = p.tax; markCe(); renderUnits($('ceUnits'), p.unit);
  $('cePanel').hidden = false;
  $('cePanel').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
const r3js = n => Math.round(n * 1000) / 1000;
$('ceClose').addEventListener('click', () => { $('cePanel').hidden = true; ceCur = null; });
$('ceSave').addEventListener('click', async () => {
  if (!ceCur) return;
  if (ceTax === null) {
    toast('اختر نسبة الضريبة للصنف أولاً', 'err');
    const c = $('ceChips'); c.classList.remove('need'); void c.offsetWidth; c.classList.add('need');
    return;
  }
  const qty = parseFloat($('ceQty').value);
  if (isNaN(qty) || qty < 0) { toast('أدخل الكمية', 'err'); $('ceQty').focus(); return; }
  const price = parseFloat($('cePrice').value);
  try {
    await store.updateProduct(ceCur.id, { cost: isNaN(price) ? ceCur.cost : price, tax: ceTax, unit: unitOf($('ceUnits')) || ceCur.unit });
    await store.setOwnCount(ceCur.id, qty, counter());
    toast('تم حفظ التعديل', 'ok');
    $('cePanel').hidden = true; ceCur = null;
    loadCe(); loadRecent();
  } catch (e) { toast(e.message, 'err'); }
});

/* ---------- الإعدادات ---------- */
$('setSave').addEventListener('click', async () => {
  try {
    await store.setMeta('deviceName', $('setName').value.trim());
    await store.setMeta('stocktakeName', $('setStocktake').value.trim() || stocktakeName());
    await store.setMeta('companyName', $('setCompany').value.trim() || 'أنوار طيبة للتموين');
    refreshHeader();
    toast('تم الحفظ', 'ok');
  } catch (e) { toast(e.message, 'err'); }
});
$('resetBtn').addEventListener('click', async () => {
  if (!(await askConfirm('سيتم مسح كل الكميات المعدودة على هذا الجهاز (الأصناف تبقى). هل صدّرت نسخة؟', 'متابعة'))) return;
  if (!(await askConfirm('هل أنت متأكد؟ لا يمكن التراجع عن هذا الإجراء.', 'نعم، امسح'))) return;
  try { await store.resetCounts(); toast('بدأ جرد جديد', 'ok'); showTab('count'); }
  catch (e) { toast(e.message, 'err'); }
});
$('wipeBtn').addEventListener('click', async () => {
  if (!(await askConfirm('سيتم مسح كل الأصناف وكل العدّ من هذا الجهاز. متابعة؟', 'متابعة'))) return;
  if (!(await askConfirm('هل أنت متأكد؟ لا يمكن التراجع عن هذا الإجراء.', 'نعم، امسح'))) return;
  try { await store.wipeAll(); toast('تم المسح', 'ok'); showTab('count'); }
  catch (e) { toast(e.message, 'err'); }
});

boot();
