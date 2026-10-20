/* مخزن البيانات المحلي (IndexedDB) + منطق الجرد. كل شي محفوظ على الجهاز نفسه. */
(function (root) {
  const Inv = (root.Inv = root.Inv || {});
  const { parse, stringify, parseNumber, safeText, cleanBarcode } = Inv.csv;

  const r3 = x => Math.round(x * 1000) / 1000;
  const r6 = x => Math.round(x * 1e6) / 1e6;
  /** مفتاح الباركود: بدون أصفار بادئة (UPC-A و EAN-13 لنفس الصنف يتطابقوا) */
  const TAX_RATES = [0, 1, 2, 5, 10, 16];
  const bkey = b => String(b == null ? '' : b).replace(/^0+(?=\d)/, '');

  /** تطبيع للبحث: يشيل التشكيل ويوحّد الألف والياء والتاء المربوطة والأرقام العربية */
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase()
      .replace(/[ً-ٰٟـ]/g, '')
      .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه')
      .replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 0x0660))
      .replace(/\s+/g, ' ').trim();
  }

  /* كلمات عناوين الأعمدة المعروفة (بعد التطبيع: ة→ه، أ→ا). الترتيب = الأولوية. */
  const HEADER_WORDS = {
    barcode: ['رقم الماده', 'رقم الصنف', 'الباركود', 'باركود', 'كود', 'رمز', 'barcode', 'code', 'sku'],
    name: ['اسم الماده', 'اسم الصنف', 'الاسم', 'الصنف', 'البيان', 'name', 'description', 'الماده'],
    unit: ['الوحده', 'وحده', 'unit'],
    system: ['الكميه الدفتريه', 'الكميه', 'الرصيد', 'رصيد', 'المخزون', 'qty', 'quantity', 'stock', 'balance'],
    tax: ['نسبه الضريبه', 'الضريبه', 'ضريبه', 'tax', 'vat'],
    cost: ['اخر سعر شراء', 'سعر الشراء', 'سعر شراء', 'سعر التكلفه', 'التكلفه', 'تكلفه', 'الكلفه', 'كلفه', 'cost', 'price'],
  };

  function detectColumns(row) {
    const heads = row.map(c => norm(c));
    const used = new Set();
    const col = {};
    for (const key of ['barcode', 'name', 'unit', 'system', 'tax', 'cost']) {
      col[key] = -1;
      outer:
      for (const kw of HEADER_WORDS[key]) {
        for (let i = 0; i < heads.length; i++) {
          if (!used.has(i) && heads[i] && heads[i].includes(kw)) { col[key] = i; used.add(i); break outer; }
        }
      }
    }
    const found = Object.values(col).some(i => i >= 0);
    const isHeader = found && !(col.barcode >= 0 && /^\d+$/.test(heads[col.barcode]));
    return { col, isHeader };
  }

  /** باركود من خلية: أرقام Excel أو نص. يشيل الفراغات والرموز الزايدة بالأطراف */
  function cleanCode(v) {
    if (v == null) return '';
    let s = typeof v === 'number' ? String(v) : cleanBarcode(String(v));
    s = s.replace(/\s+/g, '').replace(/^[\/\\.,;:*#\-_]+|[\/\\.,;:*#\-_]+$/g, '');
    return /^0+$/.test(s) ? '' : s;
  }
  function parseTax(v) {
    if (v == null || String(v).trim() === '') return undefined;
    let n = typeof v === 'number' ? v : parseNumber(String(v).replace('%', ''));
    if (n > 0 && n < 1) n = n * 100;           // 0.16 → 16
    n = Math.round(n * 100) / 100;
    return TAX_RATES.includes(n) ? n : undefined;
  }
  const cellNum = v => (v === '' || v == null || String(v).trim() === '') ? null : (typeof v === 'number' ? v : parseNumber(v));

  const SAMPLE_ROWS = [
    ['6281000000011', 'حليب نادك طويل الأجل 1 لتر', 'حبة', '48', '0.85'],
    ['6281000000028', 'أرز بسمتي 5 كغم', 'كيس', '20', '6.40'],
    ['6281000000035', 'زيت دوار الشمس 1.8 لتر', 'حبة', '36', '3.10'],
    ['6281000000042', 'سكر ناعم 1 كغم', 'كيس', '60', '0.75'],
    ['6281000000059', 'شاي ليبتون 100 كيس', 'علبة', '24', '2.20'],
    ['6281000000066', 'معكرونة سباغيتي 400 غم', 'كيس', '90', '0.45'],
    ['6281000000073', 'تونة 185 غم', 'علبة', '72', '0.95'],
    ['6281000000080', 'مياه معدنية 1.5 لتر', 'حبة', '120', '0.18'],
    ['', 'بندورة', 'كغم', '35.5', '0.60'],
    ['', 'خيار', 'كغم', '22', '0.55'],
  ];

  function createStore() {
    let db = null;
    let S = null;

    function resetState() {
      S = {
        products: new Map(),      // id → منتج
        byBarcode: new Map(),     // مفتاح الباركود → منتج
        noCode: new Map(),        // اسم مطبّع → منتج بدون باركود
        totals: new Map(),        // id → مجموع المعدود
        counts: [],               // سجل العدّ بالترتيب
        meta: {},
        nextProductId: 1,
        nextCountId: 1,
      };
    }

    /* ---------- IndexedDB ---------- */
    function openDb(name) {
      return new Promise((res, rej) => {
        const r = indexedDB.open(name, 1);
        r.onupgradeneeded = () => {
          const d = r.result;
          d.createObjectStore('products', { keyPath: 'id' });
          d.createObjectStore('counts', { keyPath: 'id' });
          d.createObjectStore('meta', { keyPath: 'key' });
        };
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    function getAll(store) {
      return new Promise((res, rej) => {
        const r = db.transaction(store, 'readonly').objectStore(store).getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    /** ينفّذ عدة عمليات بعملية واحدة (كلها تنجح أو كلها تفشل) */
    function write(stores, fn) {
      return new Promise((res, rej) => {
        const t = db.transaction(stores, 'readwrite');
        t.oncomplete = () => res();
        t.onerror = () => rej(t.error);
        t.onabort = () => rej(t.error || new Error('فشل الحفظ'));
        fn(t);
      });
    }
    const plain = p => ({ id: p.id, barcode: p.barcode, name: p.name, unit: p.unit, system: p.system, cost: p.cost, source: p.source, tax: p.tax == null ? null : p.tax, pm: !!p.pm, tm: !!p.tm });

    function indexProduct(p) {
      p._n = norm(p.name);
      p._k = p.barcode ? bkey(p.barcode) : '';
      S.products.set(p.id, p);
      if (p._k) S.byBarcode.set(p._k, p);
      else S.noCode.set(p._n, p);
      if (p.id >= S.nextProductId) S.nextProductId = p.id + 1;
    }

    async function init(dbName) {
      resetState();
      db = await openDb(dbName || 'inventory-offline');
      const [prods, counts, metas] = await Promise.all([getAll('products'), getAll('counts'), getAll('meta')]);
      prods.forEach(p => { if (p.system === undefined) p.system = null; if (p.tax === undefined) p.tax = null; indexProduct(p); });
      counts.sort((a, b) => a.id - b.id);
      for (const c of counts) {
        S.counts.push(c);
        S.totals.set(c.productId, r3((S.totals.get(c.productId) || 0) + c.qty));
        if (c.id >= S.nextCountId) S.nextCountId = c.id + 1;
      }
      metas.forEach(m => { S.meta[m.key] = m.value; });
    }

    /* ---------- الإعدادات ---------- */
    const getMeta = (k, def) => (k in S.meta ? S.meta[k] : def);
    async function setMeta(k, v) {
      await write('meta', t => t.objectStore('meta').put({ key: k, value: v }));
      S.meta[k] = v;
    }

    /* ---------- الأصناف ---------- */
    function parseProductRows(rows) {
      const items = [], errors = [];
      let skipped = 0;
      if (!rows.length) return { items, errors, skipped, columns: null };

      let { col, isHeader } = detectColumns(rows[0]);
      let start = 0;
      if (isHeader) start = 1;
      else col = { barcode: 0, name: 1, unit: 2, system: 3, cost: 4, tax: 5 };   // بدون عناوين: الترتيب القديم
      if (col.name < 0) throw new Error('لا يوجد عمود اسم الصنف في الملف');
      const get = (row, i) => (i >= 0 ? row[i] : undefined);

      for (let i = start; i < rows.length; i++) {
        const row = rows[i], line = i + 1;
        if (!row || !row.some(x => String(x == null ? '' : x).trim() !== '')) continue;
        const rawBarcode = get(row, col.barcode);
        if (typeof rawBarcode === 'string' && /^\d+(\.\d+)?E\+\d+$/i.test(rawBarcode.trim())) {
          skipped++;
          if (errors.length < 5) errors.push(`سطر ${line}: الباركود بصيغة علمية (E+)، ويجب أن يكون عمود الباركود نصاً`);
          continue;
        }
        const name = String(get(row, col.name) == null ? '' : get(row, col.name)).replace(/\s+/g, ' ').trim();
        if (!name) { skipped++; if (errors.length < 5) errors.push(`سطر ${line}: الاسم فارغ`); continue; }
        const unit = String(get(row, col.unit) == null ? '' : get(row, col.unit)).trim();
        const sys = col.system >= 0 ? cellNum(get(row, col.system)) : undefined;
        const cost = col.cost >= 0 ? cellNum(get(row, col.cost)) : undefined;
        const tax = col.tax >= 0 ? parseTax(get(row, col.tax)) : undefined;
        items.push({
          barcode: cleanCode(rawBarcode).slice(0, 64),
          name: name.slice(0, 190),
          unit: unit ? unit.slice(0, 20) : undefined,
          system: sys === undefined ? undefined : (sys === null ? null : r3(sys)),
          cost: cost == null ? undefined : r6(Math.max(0, cost)),
          tax,
        });
      }
      return { items, errors, skipped, columns: col };
    }

    function findExisting(barcode, name) {
      return barcode ? S.byBarcode.get(bkey(barcode)) : S.noCode.get(norm(name));
    }

    async function importProducts(rows) {
      const { items, errors, skipped } = parseProductRows(rows);
      let inserted = 0, updated = 0, duplicates = 0;
      const changed = [];
      const seen = new Map();   // باركود → اسم، لاكتشاف تكرار الباركود داخل نفس الملف
      for (const it of items) {
        let barcode = it.barcode;
        if (barcode) {
          const k = bkey(barcode);
          if (seen.has(k) && seen.get(k) !== norm(it.name)) {
            // نفس الباركود لصنفين مختلفين: الثاني يُضاف بدون باركود (يُلقى بالاسم) بدل ما نخسره
            duplicates++;
            if (errors.length < 5) errors.push(`باركود مكرر ${barcode}: «${it.name}» أُضيف بدون باركود`);
            barcode = '';
          } else seen.set(k, norm(it.name));
        }
        const ex = findExisting(barcode, it.name);
        if (ex) {
          ex.name = it.name; ex._n = norm(ex.name);
          if (it.unit !== undefined) ex.unit = it.unit;
          if (it.system !== undefined) ex.system = it.system;
          if (it.cost !== undefined && !ex.pm) ex.cost = it.cost;          // السعر المعدّل يدوياً ما بينمسح
          if (it.tax !== undefined && !ex.tm) ex.tax = it.tax;
          ex.source = 'import';
          if (!ex.barcode) S.noCode.set(ex._n, ex);
          if (!changed.includes(ex)) changed.push(ex);
          updated++;
        } else {
          const p = {
            id: S.nextProductId, barcode: barcode || undefined, name: it.name,
            unit: it.unit || 'حبة', system: it.system === undefined ? null : it.system,
            cost: it.cost === undefined ? 0 : it.cost, source: 'import', tax: it.tax === undefined ? null : it.tax,
          };
          indexProduct(p);
          changed.push(p);
          inserted++;
        }
      }
      if (changed.length) {
        await write('products', t => { const st = t.objectStore('products'); changed.forEach(p => st.put(plain(p))); });
      }
      return { inserted, updated, skipped, duplicates, errors };
    }

    async function addProduct({ barcode, name, unit }) {
      barcode = cleanCode(barcode);
      name = String(name || '').trim();
      if (!name) throw new Error('اكتب اسم الصنف');
      if (barcode.length > 64) throw new Error('الباركود طويل');
      const ex = barcode ? S.byBarcode.get(bkey(barcode)) : null;
      if (ex) return ex;
      const p = { id: S.nextProductId, barcode: barcode || undefined, name: name.slice(0, 190), unit: (String(unit || '').trim() || 'حبة').slice(0, 20), system: null, cost: 0, source: 'staff', tax: null };
      indexProduct(p);
      try {
        await write('products', t => t.objectStore('products').put(plain(p)));
      } catch (e) {
        S.products.delete(p.id);
        if (p._k) S.byBarcode.delete(p._k); else S.noCode.delete(p._n);
        throw e;
      }
      return p;
    }

    function makeMatcher(text) {
      text = String(text || '').trim();
      if (!text) return null;
      const tk = bkey(text);
      // "المراعي" تطابق "مراعي" و "المراعي" (نشيل ال التعريف من الكلمات الطويلة)
      const words = norm(text).split(' ').filter(Boolean).slice(0, 4)
        .map(w => (w.length > 3 && w.startsWith('ال') ? w.slice(2) : w));
      const digits = /^\d{4,}$/.test(text);
      return p => (p._k && p._k === tk)
        || (digits && p.barcode && p.barcode.includes(text))
        || (words.length > 0 && words.every(w => p._n.includes(w)));
    }
    const counted = id => S.totals.get(id) || 0;
    const view = p => ({
      id: p.id, barcode: p.barcode || null, name: p.name, unit: p.unit, counted: counted(p.id),
      cost: p.cost, tax: p.tax == null ? null : p.tax, priceBase: r6(money(p).base), priceGross: r6(money(p).gross),
    });

    /** كل الأصناف المطابقة (الأقرب أولاً): الاسم يبدأ بالكلمة قبل اللي بيحتويها بالنص */
    function lookupAll(text, limit) {
      const m = makeMatcher(text);
      if (!m) return { items: [], total: 0 };
      const exact = S.byBarcode.get(bkey(String(text).trim()));
      const first = norm(text).split(' ')[0] || '';
      const rest = [];
      for (const p of S.products.values()) if (p !== exact && m(p)) rest.push(p);
      rest.sort((a, b) => {
        const sa = a._n.startsWith(first) ? 0 : 1, sb = b._n.startsWith(first) ? 0 : 1;
        return sa - sb || (a._n < b._n ? -1 : a._n > b._n ? 1 : 0);
      });
      const all = exact ? [exact, ...rest] : rest;
      return { items: all.slice(0, limit || 200).map(view), total: all.length };
    }
    const lookup = (text, limit) => lookupAll(text, limit || 20).items;

    /* ---------- السعر والضريبة ---------- */
    const priceIncludesTax = () => !!getMeta('priceIncludesTax', false);
    /** سعر الوحدة: قبل الضريبة (base) وبعدها (gross). tax = مبلغ الضريبة للوحدة */
    function money(p) {
      const t = (p.tax || 0) / 100;
      const base = priceIncludesTax() ? p.cost / (1 + t) : p.cost;
      return { base, tax: base * t, gross: base * (1 + t) };
    }

    async function updateProduct(id, { cost, tax }) {
      const p = S.products.get(id);
      if (!p) throw new Error('الصنف غير موجود');
      const next = { cost: p.cost, tax: p.tax == null ? null : p.tax, pm: p.pm, tm: p.tm };
      if (cost !== undefined) {
        const c = Number(cost);
        if (!isFinite(c) || c < 0 || c > 1e7) throw new Error('السعر غير صحيح');
        next.cost = r6(c); next.pm = true;
      }
      if (tax !== undefined) {
        if (tax !== null && !TAX_RATES.includes(Number(tax))) throw new Error('نسبة الضريبة غير مدعومة');
        next.tax = tax === null ? null : Number(tax); next.tm = true;
      }
      const old = { cost: p.cost, tax: p.tax, pm: p.pm, tm: p.tm };
      Object.assign(p, next);
      try { await write('products', t => t.objectStore('products').put(plain(p))); }
      catch (e) { Object.assign(p, old); throw e; }
      return view(p);
    }

    /** يطبّق نسبة ضريبة على كل الأصناف المطابقة للبحث (النص الفاضي = كل الأصناف) */
    function matchingProducts(text) {
      const m = makeMatcher(text);
      const out = [];
      for (const p of S.products.values()) if (!m || m(p)) out.push(p);
      return out;
    }
    const countMatching = text => matchingProducts(text).length;
    async function bulkSetTax(text, tax) {
      if (tax !== null && !TAX_RATES.includes(Number(tax))) throw new Error('نسبة الضريبة غير مدعومة');
      const list = matchingProducts(text);
      const old = list.map(p => [p, p.tax, p.tm]);
      list.forEach(p => { p.tax = tax === null ? null : Number(tax); p.tm = true; });
      try {
        await write('products', t => { const st = t.objectStore('products'); list.forEach(p => st.put(plain(p))); });
      } catch (e) { old.forEach(([p, a, b]) => { p.tax = a; p.tm = b; }); throw e; }
      return list.length;
    }

    /* ---------- العدّ ---------- */
    async function addCount(productId, qty, counter) {
      const p = S.products.get(productId);
      if (!p) throw new Error('الصنف غير موجود');
      qty = Number(qty);
      if (!isFinite(qty) || qty <= 0 || qty > 100000) throw new Error('الكمية غير صحيحة');
      const entry = { id: S.nextCountId, productId, qty: r3(qty), counter: counter || 'هذا الجهاز', ts: Date.now() };
      await write('counts', t => t.objectStore('counts').put(entry));
      S.nextCountId++;
      S.counts.push(entry);
      S.totals.set(productId, r3(counted(productId) + entry.qty));
      return { id: entry.id, name: p.name, unit: p.unit, counted: counted(productId) };
    }

    async function undoCount(id) {
      let i = -1;
      for (let k = S.counts.length - 1; k >= 0; k--) if (S.counts[k].id === id) { i = k; break; }
      if (i < 0) throw new Error('تعذّر إلغاء هذا السطر');
      const c = S.counts[i];
      await write('counts', t => t.objectStore('counts').delete(id));
      S.counts.splice(i, 1);
      const left = r3(counted(c.productId) - c.qty);
      if (left > 0) S.totals.set(c.productId, left); else S.totals.delete(c.productId);
    }

    function recent(limit) {
      const out = [];
      for (let i = S.counts.length - 1; i >= 0 && out.length < (limit || 12); i--) {
        const c = S.counts[i];
        if (String(c.counter).startsWith('دمج:')) continue; // أسطر الدمج لا تُلغى سطراً سطراً
        const p = S.products.get(c.productId);
        out.push({ id: c.id, qty: c.qty, name: p ? p.name : '؟', unit: p ? p.unit : '', ts: c.ts });
      }
      return out;
    }

    /* ---------- الإحصائيات والتقرير ---------- */
    const hasDiff = (p, t) => p.system != null && Math.abs(t - p.system) > 0.0005;

    function stats() {
      let items = 0, value = 0, valueG = 0, diffs = 0, short = 0, shortG = 0, surplus = 0, surplusG = 0, newItems = 0, withBook = 0;
      for (const p of S.products.values()) {
        if (p.source !== 'import') newItems++;
        if (p.system != null) withBook++;
        if (!S.totals.has(p.id)) continue;
        const t = S.totals.get(p.id), m = money(p);
        items++;
        value += t * m.base; valueG += t * m.gross;
        if (hasDiff(p, t)) {
          diffs++;
          const qd = t - p.system;
          if (qd < 0) { short += qd * m.base; shortG += qd * m.gross; } else { surplus += qd * m.base; surplusG += qd * m.gross; }
        }
      }
      return {
        products: S.products.size, items, entries: S.counts.length, diffs, newItems, withBook,
        value: r3(value), valueG: r3(valueG), tax: r3(valueG - value),
        short: r3(short), shortG: r3(shortG), surplus: r3(surplus), surplusG: r3(surplusG),
      };
    }

    function rowOf(p) {
      const has = S.totals.has(p.id);
      const c = has ? S.totals.get(p.id) : 0;
      const book = p.system != null;
      const m = money(p);
      return {
        id: p.id, barcode: p.barcode || null, name: p.name, unit: p.unit,
        tax: p.tax == null ? null : p.tax,
        system: book ? p.system : null, counted: c, uncounted: !has,
        diff: book ? r3(c - p.system) : null,
        value: book ? r3((c - p.system) * m.base) : null,
        valueG: book ? r3((c - p.system) * m.gross) : null,
        amount: r3(c * m.base), amountG: r3(c * m.gross),
      };
    }

    function report(filter, text, offset, limit, taxFilter) {
      const m = makeMatcher(text);
      const rows = [];
      for (const p of S.products.values()) {
        if (m && !m(p)) continue;
        if (taxFilter !== undefined && taxFilter !== '' && taxFilter !== 'all') {
          if (taxFilter === 'none' ? p.tax != null : p.tax !== Number(taxFilter)) continue;
        }
        const has = S.totals.has(p.id);
        if (filter === 'uncounted' && has) continue;
        if (filter === 'counted' && !has) continue;
        if (filter === 'diff' && !(has && hasDiff(p, S.totals.get(p.id)))) continue;
        rows.push(p);
      }
      if (filter === 'diff') {
        const v = new Map(rows.map(p => [p.id, Math.abs(rowOf(p).value)]));
        rows.sort((a, b) => v.get(b.id) - v.get(a.id) || (a._n < b._n ? -1 : 1));
      } else if (filter === 'counted') {
        const v = new Map(rows.map(p => [p.id, rowOf(p).amount]));
        rows.sort((a, b) => v.get(b.id) - v.get(a.id) || (a._n < b._n ? -1 : 1));   // الأعلى قيمة أولاً
      } else {
        rows.sort((a, b) => (a._n < b._n ? -1 : a._n > b._n ? 1 : 0));
      }
      const total = rows.length;
      offset = offset || 0; limit = limit || 100;
      return { rows: rows.slice(offset, offset + limit).map(rowOf), total, hasMore: offset + limit < total };
    }

    /** تقرير حسب فئة الضريبة (للأصناف المعدودة). الفئات: 0,1,2,5,10,16 + "غير محدد" */
    function taxReport() {
      const cats = [...TAX_RATES, null].map(rate => ({ tax: rate, products: 0, items: 0, qty: 0, base: 0, taxAmount: 0, gross: 0 }));
      const at = rate => cats[rate === null ? cats.length - 1 : TAX_RATES.indexOf(rate)];
      for (const p of S.products.values()) {
        const c = at(p.tax == null ? null : p.tax);
        c.products++;
        if (!S.totals.has(p.id)) continue;
        const t = S.totals.get(p.id), m = money(p);
        c.items++; c.qty += t; c.base += t * m.base; c.taxAmount += t * m.tax; c.gross += t * m.gross;
      }
      const total = { products: 0, items: 0, qty: 0, base: 0, taxAmount: 0, gross: 0 };
      for (const c of cats) {
        for (const k of ['qty', 'base', 'taxAmount', 'gross']) c[k] = r3(c[k]);
        for (const k of Object.keys(total)) total[k] += c[k];
      }
      for (const k of ['qty', 'base', 'taxAmount', 'gross']) total[k] = r3(total[k]);
      return { cats, total, includesTax: priceIncludesTax() };
    }

    /* ---------- التصدير والدمج ---------- */
    const HEADER = ['الباركود', 'الصنف', 'الوحدة', 'الكمية الدفترية', 'الكمية المعدودة', 'الفرق', 'التكلفة', 'قيمة الفرق', 'الحالة', 'الجهاز', 'قيمة المعدود', 'الضريبة %', 'السعر قبل الضريبة', 'السعر بعد الضريبة', 'المعدود قبل الضريبة', 'مبلغ الضريبة', 'المعدود بعد الضريبة'];

    function exportCsv() {
      const list = [...S.products.values()].sort((a, b) => (a._n < b._n ? -1 : a._n > b._n ? 1 : 0));
      const rows = [HEADER];
      const device = getMeta('deviceName', '') || 'جهاز';
      for (const p of list) {
        const r = rowOf(p);
        const status = r.uncounted ? 'لم يُعدّ'
          : r.diff === null ? 'معدود'
          : (r.diff === 0 ? 'مطابق' : (r.diff > 0 ? 'زيادة' : 'نقص'));
        rows.push([
          p.barcode ? '="' + p.barcode + '"' : '',
          safeText(p.name), safeText(p.unit),
          r.system === null ? '' : r.system, r.counted, r.diff === null ? '' : r.diff,
          p.cost, r.value === null ? '' : r.value, status, device, r.amount,
          p.tax == null ? '' : p.tax, r6(money(p).base), r6(money(p).gross),
          r.amount, r3(r.amountG - r.amount), r.amountG,
        ]);
      }
      return stringify(rows);
    }

    function exportTaxCsv() {
      const rep = taxReport();
      const rows = [['فئة الضريبة', 'عدد الأصناف', 'أصناف معدودة', 'الكمية المعدودة', 'القيمة قبل الضريبة', 'مبلغ الضريبة', 'القيمة بعد الضريبة']];
      for (const c of rep.cats) {
        if (c.tax === null && c.products === 0) continue;
        rows.push([c.tax === null ? 'غير محدد (محسوب 0%)' : c.tax + '%', c.products, c.items, c.qty, c.base, c.taxAmount, c.gross]);
      }
      const t = rep.total;
      rows.push(['المجموع', t.products, t.items, t.qty, t.base, t.taxAmount, t.gross]);
      return stringify(rows);
    }

    /** يدمج ملف جرد مُصدَّر من جهاز ثاني. دمج ملف جديد من نفس الجهاز يستبدل الدمج السابق (ما بيتضاعف العدّ). */
    async function mergeCsv(text, fallbackLabel) {
      const rows = parse(text);
      const head = (rows[0] || []).map(h => String(h).trim());
      if (!head.some(h => /الكمية المعدودة|counted/i.test(h))) {
        throw new Error('هذا الملف ليس ملف جرد مُصدَّر من التطبيق');
      }
      const srcIdx = head.indexOf('الجهاز');
      const fromFile = srcIdx >= 0 && rows[1] ? String(rows[1][srcIdx] || '').trim() : '';
      const label = fromFile || fallbackLabel || 'جهاز آخر';
      if (label === getMeta('deviceName', '')) {
        throw new Error('هذا الملف من هذا الجهاز نفسه (' + label + ')');
      }
      const taxIdx = head.indexOf('الضريبة %');
      const counter = 'دمج: ' + label;
      const old = S.counts.filter(c => c.counter === counter);

      const newProducts = [], newCounts = [];
      const pending = new Map();   // أصناف جديدة داخل نفس الملف
      let skipped = 0;
      for (const row of rows.slice(1)) {
        const barcode = cleanCode(cleanBarcode(row[0]));
        const name = String(row[1] == null ? '' : row[1]).trim();
        const qty = r3(parseNumber(row[4]));
        if (!name || qty <= 0) { skipped++; continue; }
        const key = barcode ? bkey(barcode) : 'n:' + norm(name);
        let p = findExisting(barcode, name) || pending.get(key);
        if (!p) {
          const sys = cellNum(row[3]);
          p = {
            id: S.nextProductId + newProducts.length, barcode: barcode || undefined, name: name.slice(0, 190),
            unit: (String(row[2] || '').trim() || 'حبة').slice(0, 20),
            system: sys === null ? null : r3(sys), cost: r6(Math.max(0, parseNumber(row[6]))), source: 'merged',
            tax: taxIdx >= 0 ? (parseTax(row[taxIdx]) === undefined ? null : parseTax(row[taxIdx])) : null,
          };
          pending.set(key, p);
          newProducts.push(p);
        }
        newCounts.push({ id: S.nextCountId + newCounts.length, productId: p.id, qty, counter, ts: Date.now() });
      }
      await write(['products', 'counts'], t => {
        old.forEach(c => t.objectStore('counts').delete(c.id));
        newProducts.forEach(p => t.objectStore('products').put(plain(p)));
        newCounts.forEach(c => t.objectStore('counts').put(c));
      });
      // نحدّث الذاكرة بعد نجاح الحفظ
      for (const c of old) {
        const left = r3(counted(c.productId) - c.qty);
        if (left > 0) S.totals.set(c.productId, left); else S.totals.delete(c.productId);
      }
      S.counts = S.counts.filter(c => c.counter !== counter);
      newProducts.forEach(indexProduct);
      for (const c of newCounts) {
        S.counts.push(c);
        S.totals.set(c.productId, r3(counted(c.productId) + c.qty));
      }
      S.nextCountId += newCounts.length;
      return { merged: newCounts.length, created: newProducts.length, skipped, label, replaced: old.length };
    }

    /* ---------- التصفير ---------- */
    async function resetCounts() {
      await write('counts', t => t.objectStore('counts').clear());
      S.counts = []; S.totals = new Map(); S.nextCountId = 1;
    }
    async function wipeAll() {
      await write(['products', 'counts'], t => { ['products', 'counts'].forEach(n => t.objectStore(n).clear()); });
      const meta = S.meta;
      resetState();
      S.meta = meta;
    }

    return {
      init, getMeta, setMeta, importProducts, addProduct, lookup, lookupAll, addCount, undoCount, recent,
      getProduct: id => { const x = S.products.get(id); return x ? view(x) : null; },
      updateProduct, bulkSetTax, countMatching, taxReport, exportTaxCsv, TAX_RATES,
      stats, report, exportCsv, mergeCsv, resetCounts, wipeAll,
      get productCount() { return S.products.size; },
    };
  }

  Inv.createStore = createStore;
  Inv.norm = norm;
  Inv.sampleRows = SAMPLE_ROWS;
})(typeof window !== 'undefined' ? window : globalThis);
