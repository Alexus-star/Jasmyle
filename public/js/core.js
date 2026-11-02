'use strict';
/* Jasmyle Properties frontend core: DOM helper, API client, UI kit, router, app shell, sign-in. No innerHTML anywhere: all user data is inserted as text. */
(function () {
  const NH = (window.NH = { user: null, csrf: null, routes: [], ui: {} });

  /* ---------- DOM ---------- */
  function add(el, kids) { for (const k of kids.flat(Infinity)) { if (k === null || k === undefined || k === false) continue; el.append(k.nodeType ? k : document.createTextNode(String(k))); } }
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (['checked', 'disabled', 'selected', 'required', 'multiple', 'autofocus', 'readOnly'].includes(k)) el[k] = !!v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    add(el, kids); return el;
  }
  const $ = (s, r = document) => r.querySelector(s);
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  NH.h = h; NH.$ = $; NH.clear = clear;

  const ICONS = {
    home: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10', building: 'M3 21h18 M5 21V7l7-4 7 4v14 M9 9h.01 M9 13h.01 M9 17h.01 M15 9h.01 M15 13h.01 M15 17h.01',
    users: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75', card: 'M1 4h22v16H1z M1 10h22',
    cash: 'M12 1v22 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6', wrench: 'M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z',
    clip: 'M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M9 2h6v4H9z M9 13l2 2 4-4', chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
    chart: 'M18 20V10 M12 20V4 M6 20v-6', file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6', bell: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0',
    sliders: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6', shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16 M21 21l-4.35-4.35',
    logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9', plus: 'M12 5v14 M5 12h14', check: 'M20 6L9 17l-5-5', x: 'M18 6L6 18 M6 6l12 12',
    key: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.78 7.78 5.5 5.5 0 0 1 7.78-7.78zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4', menu: 'M3 12h18 M3 6h18 M3 18h18',
    alert: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01', phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
    eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6', download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3',
    print: 'M6 9V2h12v7 M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2 M6 14h12v8H6z', mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M22 6l-10 7L2 6',
    globe: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20 M2 12h20 M12 2a15 15 0 0 1 0 20 M12 2a15 15 0 0 0 0 20', star: 'M12 2l3 7 7 .6-5.3 4.7 1.7 7.2L12 17.8 5.6 21.5l1.7-7.2L2 9.6 9 9z', lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',
  };
  function icon(name) {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2'); s.setAttribute('stroke-linecap', 'round'); s.setAttribute('stroke-linejoin', 'round');
    for (const d of (ICONS[name] || ICONS.file).split(' M').map((x, i) => (i ? 'M' + x : x))) { const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', d); s.appendChild(p); }
    return s;
  }
  const LOGO_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="jsky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#071f4d"/><stop offset="1" stop-color="#0b3d91"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#jsky)"/><path d="M14 9l1.2 2.8 3 .3-2.3 2 .7 3-2.6-1.6-2.6 1.6.7-3-2.3-2 3-.3z" fill="#ffd166"/><path d="M33 6l.9 2.1 2.2.2-1.7 1.5.5 2.2-1.9-1.2-1.9 1.2.5-2.2-1.7-1.5 2.2-.2z" fill="#ffd166"/><path d="M50 13l1.1 2.5 2.7.3-2 1.8.6 2.7-2.4-1.4-2.4 1.4.6-2.7-2-1.8 2.7-.3z" fill="#ffd166"/><circle cx="24" cy="19" r="1" fill="#fff"/><circle cx="43" cy="9" r="1" fill="#fff"/><circle cx="58" cy="25" r="1" fill="#fff"/><circle cx="6" cy="26" r="1" fill="#fff"/><path d="M0 64V40h7v-5h6v-4h5v9h5V30h6v8h4v-6h6v9h5v-7h6v-5h5v10h5v24z" fill="#2a63c4"/><path d="M0 64V52h64v12z" fill="#05163a"/><path d="M17 56V40.5L32 27l15 13.5V56z" fill="#fff"/><path d="M13.5 41.5L32 24.5l18.5 17" fill="none" stroke="#d62839" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/><rect x="28" y="45" width="8" height="11" rx="1" fill="#d62839"/><rect x="20.5" y="43" width="4.5" height="4.5" rx=".6" fill="#0b3d91"/><rect x="39" y="43" width="4.5" height="4.5" rx=".6" fill="#0b3d91"/></svg>';
  function logo() {
    const s = document.importNode(new DOMParser().parseFromString(LOGO_SVG, 'image/svg+xml').documentElement, true);
    return h('div', { class: 'logo' }, s);
  }
  NH.icon = icon; NH.logo = logo;

  /* ---------- formatting ---------- */
  const money = (n) => 'KES ' + Number(n || 0).toLocaleString('en-KE', { maximumFractionDigits: 2 });
  const num = (n) => Number(n || 0).toLocaleString('en-KE');
  const fdate = (v) => { if (!v) return '-'; const d = typeof v === 'number' ? new Date(v) : new Date(v + 'T00:00:00'); return d.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const fdt = (v) => (v ? new Date(v).toLocaleString('en-KE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-');
  const phone = (p) => (p ? (String(p).startsWith('254') ? '0' + String(p).slice(3) : p) : '');
  const ago = (ts) => { const s = Math.max(1, (Date.now() - ts) / 1000); if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' h ago'; return fdate(ts); };
  const today = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
  const thisMonth = () => today().slice(0, 7);
  const monthName = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('en-KE', { month: 'long', year: 'numeric' });
  const METHOD = { mpesa: 'M-Pesa', paypal: 'PayPal / Card', bank: 'Bank', cash: 'Cash', cheque: 'Cheque' };
  const ROLE = { national_admin: 'National Administrator', landlord: 'Landlord', property_manager: 'Property Manager', caretaker: 'Caretaker', contractor: 'Contractor', tenant: 'Tenant' };
  Object.assign(NH, { money, num, fdate, fdt, phone, ago, today, thisMonth, monthName, METHOD, ROLE });

  /* ---------- API ---------- */
  class ApiError extends Error { constructor(m, status, code) { super(m); this.status = status; this.code = code; } }
  async function api(method, url, body, opts = {}) {
    const init = { method, headers: {}, credentials: 'same-origin' };
    if (NH.csrf) init.headers['X-CSRF-Token'] = NH.csrf;
    if (opts.raw) { init.body = body; init.headers['Content-Type'] = 'application/octet-stream'; } else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
    let r;
    try { r = await fetch(url, init); } catch { throw new ApiError('Cannot reach the server. Check your internet connection and try again.', 0); }
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : null;
    if (!r.ok) {
      const e = new ApiError((data && data.error) || 'Something went wrong', r.status, data && data.code);
      if (r.status === 401 && NH.user && !opts.quiet) { NH.user = null; NH.csrf = null; toast('Your session ended. Please sign in again.', 'bad'); start(); }
      throw e;
    }
    return data;
  }
  NH.api = api;
  NH.get = (u) => api('GET', u); NH.post = (u, b) => api('POST', u, b || {}); NH.put = (u, b) => api('PUT', u, b); NH.del = (u) => api('DELETE', u);
  NH.can = (p) => !!(NH.user && NH.user.perms.includes(p));
  NH.canAny = (...ps) => ps.some((p) => NH.can(p));

  /* ---------- UI kit ---------- */
  function toast(msg, kind) {
    let box = $('#toasts'); if (!box) { box = h('div', { id: 'toasts' }); document.body.append(box); }
    const t = h('div', { class: 'toast ' + (kind || '') }, msg); box.append(t);
    setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 4000);
  }
  function modal(title, body, { actions, wide, onClose } = {}) {
    const close = () => { ov.remove(); document.removeEventListener('keydown', esc); if (onClose) onClose(); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    const ov = h('div', { class: 'overlay', onmousedown: (e) => { if (e.target === ov) close(); } },
      h('div', { class: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
        h('div', { class: 'mh' }, h('h2', null, title), h('button', { class: 'x', onclick: close, 'aria-label': 'Close' }, icon('x'))),
        h('div', { class: 'mb' }, body), actions ? h('div', { class: 'mf' }, actions(close)) : null));
    document.body.append(ov); document.addEventListener('keydown', esc);
    const first = ov.querySelector('input,select,textarea'); if (first) setTimeout(() => first.focus(), 30);
    return { close, el: ov };
  }
  function confirmBox(title, text, okLabel, danger) {
    return new Promise((res) => {
      let done = false;
      const m = modal(title, h('p', null, text), { onClose: () => { if (!done) res(false); }, actions: (close) => [h('button', { class: 'btn line', onclick: close }, 'Cancel'), h('button', { class: 'btn ' + (danger ? 'red' : ''), onclick: () => { done = true; res(true); close(); } }, okLabel || 'Yes')] });
    });
  }
  /** busy(button, asyncFn): disables the button while running, shows the error as a toast */
  async function busy(btn, fn) {
    if (btn) btn.disabled = true;
    try { return await fn(); } catch (e) { toast(e.message, 'bad'); } finally { if (btn) btn.disabled = false; }
  }
  Object.assign(NH.ui, { toast, modal, confirmBox, busy });

  const badge = (text, kind) => h('span', { class: 'badge ' + (kind || '') }, text);
  const STATE = { paid: ['Paid', 'ok'], open: ['Unpaid', 'warn'], waived: ['Waived', 'ok'], due: ['Due', ''], partial: ['Part-paid', 'warn'], overdue: ['Overdue', 'bad'], void: ['Cancelled', 'gray'], completed: ['Completed', 'ok'], pending: ['Waiting', 'warn'], failed: ['Failed', 'bad'], reversed: ['Reversed', 'gray'], awaiting_confirmation: ['To confirm', 'warn'],
    submitted: ['New', 'warn'], approved: ['Approved', ''], assigned: ['Assigned', ''], in_progress: ['In progress', ''], rejected: ['Declined', 'bad'], cancelled: ['Cancelled', 'gray'], active: ['Active', 'ok'], suspended: ['Suspended', 'bad'], ended: ['Ended', 'gray'], vacant: ['Vacant', 'warn'], occupied: ['Occupied', 'ok'], maintenance: ['Repairs', 'bad'], new: ['New', 'warn'], contacted: ['Contacted', ''], closed: ['Closed', 'gray'], urgent: ['Urgent', 'bad'], normal: ['Normal', ''], low: ['Low', 'gray'] };
  const stateBadge = (s) => { const x = STATE[s] || [s, '']; return badge(x[0], x[1]); };
  Object.assign(NH, { badge, stateBadge });

  const card = (...kids) => h('div', { class: 'card' }, kids);
  const stat = (label, value, sub, cls) => h('div', { class: 'card stat ' + (cls || '') }, h('div', { class: 'lbl' }, label), h('div', { class: 'val' }, value), sub ? h('div', { class: 'sub' }, sub) : null);
  const empty = (text, ic) => h('div', { class: 'empty' }, icon(ic || 'file'), h('p', null, text));
  const pageHead = (title, ...actions) => h('div', { class: 'head', style: { marginBottom: '1rem' } }, h('h1', null, title), h('div', { class: 'row' }, actions));
  /** table(cols, rows, {onRow}) - cols: [{h:'Head', c:(row)=>Node|string, cls}] */
  function table(cols, rows, opts = {}) {
    if (!rows.length) return empty(opts.empty || 'Nothing here yet', opts.icon);
    return h('div', { class: 'tw' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, cols.map((c) => h('th', { class: c.cls || '' }, c.h)))),
      h('tbody', null, rows.map((r) => h('tr', { class: opts.onRow ? 'click' : '', onclick: opts.onRow ? () => opts.onRow(r) : null }, cols.map((c) => h('td', { class: c.cls || '' }, c.c(r))))))));
  }
  Object.assign(NH.ui, { card, stat, empty, pageHead, table });

  /** form({fields:[{name,label,type,options,required,value,hint,full}]}) -> {el, values(), set(name,v)} */
  function form(fields, opts = {}) {
    const inputs = {};
    const el = h('div', { class: 'form-grid' });
    for (const f of fields) {
      let inp;
      const t = f.type || 'text';
      if (t === 'select') inp = h('select', { name: f.name }, (f.options || []).map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: String(v) === String(f.value ?? '') }, l); }));
      else if (t === 'textarea') inp = h('textarea', { name: f.name, maxlength: f.max || 1000, placeholder: f.placeholder || '' }, f.value || '');
      else if (t === 'checkbox') inp = h('input', { type: 'checkbox', name: f.name, checked: !!f.value });
      else if (t === 'multi') { // list of checkboxes
        inp = h('div', { class: 'stack' }, (f.options || []).map(([v, l]) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', value: v, checked: (f.value || []).includes(v) }), l)));
      } else inp = h('input', { type: t, name: f.name, value: f.value ?? '', placeholder: f.placeholder || '', inputmode: f.inputmode, autocomplete: f.auto || 'off', min: f.min, max: f.max, step: f.step || (t === 'number' ? 'any' : null), maxlength: t === 'text' ? f.maxlength || 200 : null });
      inputs[f.name] = { inp, f };
      if (t === 'checkbox') el.append(h('div', { class: 'f' + (f.full ? ' full' : '') }, h('label', { class: 'chk' }, inp, f.label), f.hint ? h('div', { class: 'hint' }, f.hint) : null));
      else el.append(h('div', { class: 'f' + (f.full || t === 'textarea' || t === 'multi' ? ' full' : '') }, h('label', null, f.label + (f.required ? ' *' : '')), inp, f.hint ? h('div', { class: 'hint' }, f.hint) : null));
    }
    function values() {
      const out = {};
      for (const [n, { inp, f }] of Object.entries(inputs)) {
        const t = f.type || 'text';
        if (t === 'checkbox') out[n] = inp.checked;
        else if (t === 'multi') out[n] = [...inp.querySelectorAll('input:checked')].map((i) => i.value);
        else if (t === 'number') out[n] = inp.value === '' ? undefined : Number(inp.value);
        else out[n] = inp.value === '' ? undefined : inp.value;
        if (f.required && (out[n] === undefined || (Array.isArray(out[n]) && !out[n].length && f.type === 'multi' && f.requireOne))) throw new Error(`${f.label} is required`);
      }
      return out;
    }
    return { el, values, inputs, set: (n, v) => { inputs[n].inp.value = v; } };
  }
  NH.form = form;

  function tabs(items, active, onPick) {
    const wrap = h('div', { class: 'tabs' });
    const paint = (a) => { clear(wrap); for (const [k, l] of items) wrap.append(h('button', { class: k === a ? 'on' : '', onclick: () => { paint(k); onPick(k); } }, l)); };
    paint(active); return wrap;
  }
  NH.tabs = tabs;

  function barChart(trend) {
    const max = Math.max(1, ...trend.flatMap((t) => [t.income, t.expenses]));
    return h('div', null, h('div', { class: 'chart' }, trend.map((t) => h('div', { class: 'col' }, h('div', { class: 'pair' }, h('div', { class: 'b i', title: 'Income ' + money(t.income), style: { height: Math.max(1, (t.income / max) * 100) + '%' } }), h('div', { class: 'b e', title: 'Expenses ' + money(t.expenses), style: { height: Math.max(1, (t.expenses / max) * 100) + '%' } })), h('div', { class: 'l' }, new Date(t.month + '-01T00:00:00').toLocaleDateString('en-KE', { month: 'short' }))))),
      h('div', { class: 'legend', style: { marginTop: '.5rem' } }, h('span', null, h('i', { style: { background: 'var(--b6)' } }), 'Income'), h('span', null, h('i', { style: { background: 'var(--r6)' } }), 'Expenses')));
  }
  NH.barChart = barChart;

  /** open a stored (encrypted) file safely: fetched with the session cookie, shown from a blob URL */
  function fileThumb(f) {
    const url = '/api/files/' + f.id;
    if (f.mime.startsWith('image/')) return h('img', { src: url, alt: f.name, loading: 'lazy', onclick: () => modal(f.name, h('img', { src: url, style: { maxWidth: '100%', borderRadius: '10px' } }), { wide: true }) });
    if (f.mime.startsWith('video/')) return h('video', { src: url, controls: true, preload: 'metadata' });
    return h('a', { class: 'btn ghost sm', href: url, target: '_blank', rel: 'noopener' }, icon('file'), f.name);
  }
  async function uploadFiles(refType, refId, fileList) {
    for (const f of [...fileList].slice(0, 5)) {
      await api('POST', `/api/files?refType=${refType}&refId=${refId}&name=${encodeURIComponent(f.name)}`, f, { raw: true });
    }
  }
  Object.assign(NH, { fileThumb, uploadFiles });

  /* ---------- router ---------- */
  function route(pattern, fn, opts) {
    const keys = []; const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    NH.routes.push({ re, keys, fn, opts: opts || {}, pattern });
  }
  NH.route = route;
  let viewEl = null; let navToken = 0;
  function parseHash() { const raw = location.hash.replace(/^#/, '') || '/'; const [p, q] = raw.split('?'); return { path: p || '/', query: Object.fromEntries(new URLSearchParams(q || '')) }; }
  async function renderRoute() {
    const { path, query } = parseHash(); const token = ++navToken;
    for (const r of NH.routes) {
      const m = path.match(r.re); if (!m) continue;
      if (r.opts.auth !== false && !NH.user) { return; }
      const params = {}; r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      const target = r.opts.auth === false && !NH.user ? NH.publicView : viewEl;
      if (!target) return;
      clear(target).append(h('div', { class: 'spin' }));
      try {
        const node = await r.fn(params, query);
        if (token !== navToken) return;
        clear(target).append(node);
        const title = r.opts.title || ''; document.title = (title ? title + ' - ' : '') + 'Jasmyle Properties';
        if (NH.setActive) NH.setActive(path);
        window.scrollTo(0, 0);
      } catch (e) {
        if (token !== navToken) return;
        clear(target).append(card(h('h2', null, 'We could not load this page'), h('p', { class: 'muted' }, e.message), h('button', { class: 'btn', onclick: renderRoute }, 'Try again')));
      }
      return;
    }
    if (NH.user) go(NH.home());
  }
  const go = (p) => { if (location.hash === '#' + p) renderRoute(); else location.hash = p; };
  NH.go = go; NH.refresh = renderRoute;
  window.addEventListener('hashchange', () => { document.querySelector('.side') && document.querySelector('.side').classList.remove('open'); renderRoute(); });

  /* ---------- app shell ---------- */
  const NAV = {
    national_admin: [['/admin', 'Overview', 'chart'], ['/admin/landlords', 'Landlords', 'users'], ['/admin/properties', 'Property verification', 'shield'], ['/admin/admins', 'Administrators', 'key'], ['/admin/audit', 'Audit trail', 'clip'], ['/admin/revenue', 'Pricing & revenue', 'cash'], ['/admin/platform', 'Platform settings', 'sliders'], ['/admin/marketplace', 'Marketplace & verification', 'globe'], ['/admin/privacy', 'Privacy & legal', 'lock'], ['/admin/rules', 'Integrations & tax rules', 'shield'], ['/admin/system', 'System & backups', 'sliders'], ['/admin/metrics', 'Server health', 'chart'], ['/roles', 'Roles & permissions', 'lock']],
    landlord: [['/', 'Dashboard', 'home'], ['/properties', 'Properties', 'building'], ['/tenants', 'Tenants', 'users'], ['/leases', 'Leases', 'file'], ['/payments', 'Rent & payments', 'card'], ['/utilities', 'Water & electricity', 'cash'], ['/expenses', 'Expenses', 'cash'], ['/maintenance', 'Maintenance', 'wrench', 'maint'], ['/inspections', 'Inspections', 'clip'], ['/contractors', 'Contractors', 'wrench'], ['/reports', 'Reports', 'chart'], ['/chat', 'Messages', 'chat', 'chat'], ['/enquiries', 'Enquiries', 'mail'], ['/viewings', 'Viewings', 'clip'], ['/ecosystem', 'Real estate hub', 'globe'], ['/sales', 'Sales & land', 'home'], ['/leads', 'Leads & deals', 'users'], ['/stays', 'Short stays', 'key'], ['/projects', 'Projects', 'building'], ['/assets', 'Assets & servicing', 'wrench'], ['/compliance', 'Licences & insurance', 'shield'], ['/services', 'Find a professional', 'search'], ['/staff', 'Staff & access', 'key'], ['/import', 'Import from CSV', 'file'], ['/billing', 'Platform fee', 'cash'], ['/tax', 'Tax & KRA', 'file'], ['/settings', 'Payment settings', 'sliders'], ['/audit', 'Audit trail', 'shield'], ['/roles', 'Roles & permissions', 'lock']],
    property_manager: [['/', 'Dashboard', 'home'], ['/properties', 'My properties', 'building'], ['/tenants', 'Tenants', 'users'], ['/leases', 'Leases', 'file'], ['/payments', 'Rent & payments', 'card'], ['/utilities', 'Water & electricity', 'cash'], ['/expenses', 'Expenses', 'cash'], ['/maintenance', 'Maintenance', 'wrench', 'maint'], ['/inspections', 'Inspections', 'clip'], ['/contractors', 'Contractors', 'wrench'], ['/reports', 'Reports', 'chart'], ['/chat', 'Messages', 'chat', 'chat'], ['/enquiries', 'Enquiries', 'mail'], ['/viewings', 'Viewings', 'clip'], ['/ecosystem', 'Real estate hub', 'globe'], ['/sales', 'Sales & land', 'home'], ['/leads', 'Leads & deals', 'users'], ['/stays', 'Short stays', 'key'], ['/assets', 'Assets & servicing', 'wrench'], ['/compliance', 'Licences & insurance', 'shield'], ['/services', 'Find a professional', 'search'], ['/import', 'Import from CSV', 'file'], ['/roles', 'Roles & permissions', 'lock']],
    caretaker: [['/', 'Dashboard', 'home'], ['/properties', 'My properties', 'building'], ['/tenants', 'Tenants', 'users'], ['/utilities', 'Meter readings', 'cash'], ['/maintenance', 'Maintenance', 'wrench', 'maint'], ['/inspections', 'Inspections', 'clip'], ['/assets', 'Assets & servicing', 'wrench'], ['/chat', 'Messages', 'chat', 'chat'], ['/roles', 'Roles & permissions', 'lock']],
    contractor: [['/', 'My jobs', 'wrench'], ['/roles', 'Roles & permissions', 'lock']],
    tenant: [['/', 'My home', 'home'], ['/pay', 'Pay rent', 'card'], ['/payments', 'Receipts & history', 'file'], ['/maintenance', 'Repairs', 'wrench'], ['/chat', 'Messages', 'chat', 'chat'], ['/lease', 'My lease', 'clip'], ['/find', 'Find a home', 'search'], ['/buy', 'Homes for sale', 'home'], ['/services', 'Find a professional', 'search'], ['/roles', 'Roles & permissions', 'lock']],
  };
  NH.home = () => '/';
  function shell() {
    const u = NH.user;
    const side = h('aside', { class: 'side' });
    const nav = h('nav', { class: 'nav' });
    for (const [p, l, ic, key] of NAV[u.role]) nav.append(h('a', { href: '#' + p, 'data-p': p, 'data-k': key || '' }, icon(ic), l, key ? h('span', { class: 'cnt hide', 'data-cnt': key }) : null));
    NAV[u.role] = NAV[u.role].concat(NAV[u.role].some((x) => x[0] === '/privacy-centre') ? [] : [['/privacy-centre', 'Privacy centre', 'lock']]);
    for (const [p, l, ic, key] of NAV[u.role].slice(-1)) nav.append(h('a', { href: '#' + p, 'data-p': p, 'data-k': '' }, icon(ic), l));
    side.append(h('div', { class: 'brand' }, logo(), h('span', null, 'Jasmyle ', h('small', null, 'Properties'))), nav,
      h('div', { class: 'who' }, h('b', null, u.name), h('span', null, ROLE[u.role] + (u.orgName && u.role !== 'national_admin' ? ' - ' + u.orgName : '')), h('div', { class: 'row', style: { marginTop: '.6rem' } }, h('a', { class: 'btn ghost sm', href: '#/account' }, icon('key'), 'Account'), h('button', { class: 'btn sm red', onclick: signOut }, icon('logout'), 'Sign out'))));
    side.append(h('div', { class: 'legal-links' }, h('a', { href: '#/about' }, 'About'), ' · ', h('a', { href: '#/terms' }, 'Terms'), ' · ', h('a', { href: '#/privacy' }, 'Privacy')));
    const bell = h('div', { style: { position: 'relative' } });
    const top = h('header', { class: 'top' }, h('button', { class: 'icon-btn menu-btn', 'aria-label': 'Menu', onclick: () => side.classList.toggle('open') }, icon('menu')), h('div', { class: 'grow' }, h('strong', { id: 'pagetitle', class: 'blue' }, 'Jasmyle Properties')), ['landlord', 'property_manager', 'caretaker'].includes(u.role) ? searchBox() : null, bell);
    viewEl = h('main', { class: 'content', id: 'view' });
    const banner = u.mode === 'simulate' && ['landlord', 'property_manager', 'tenant'].includes(u.role) ? h('div', { class: 'banner' }, 'PRACTICE MODE - payments are simulated and no real money moves. ', u.role === 'landlord' ? h('a', { href: '#/settings' }, 'Go live in Payment settings') : null) : null;
    NH.setActive = (path) => { for (const a of nav.querySelectorAll('a')) { const p = a.dataset.p; a.classList.toggle('on', p === path || (p !== '/' && path.startsWith(p + '/')) || (p === '/' && path === '/')); } };
    clear($('#app')).append(h('div', { class: 'shell' }, side, h('div', { class: 'main' }, banner, top, viewEl)));
    setupBell(bell, nav);
    if (NH.onShell) NH.onShell(u);
  }
  function searchBox() {
    const i = h('input', { type: 'search', placeholder: 'Search…', 'aria-label': 'Search everything', class: 'topsearch' });
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter' && i.value.trim().length >= 2) { go('/search?q=' + encodeURIComponent(i.value.trim())); i.value = ''; i.blur(); } });
    return i;
  }
  function setupBell(bell, nav) {
    const dot = h('span', { class: 'dot hide' }); const btn = h('button', { class: 'icon-btn', 'aria-label': 'Notifications' }, icon('bell'), dot); let pop = null;
    bell.append(btn);
    async function poll() {
      if (!NH.user) return;
      try {
        const d = await api('GET', '/api/notifications', undefined, { quiet: true }); dot.textContent = d.unread; dot.classList.toggle('hide', !d.unread);
        const chat = d.notifications.filter((n) => !n.read && n.kind === 'chat').length, mt = d.notifications.filter((n) => !n.read && n.kind === 'maintenance').length;
        for (const [k, v] of [['chat', chat], ['maint', mt]]) { const c = nav.querySelector(`[data-cnt="${k}"]`); if (c) { c.textContent = v; c.classList.toggle('hide', !v); } }
        NH._notes = d.notifications;
      } catch { /* ignore */ }
    }
    btn.onclick = async () => {
      if (pop) { pop.remove(); pop = null; return; }
      await poll();
      pop = h('div', { class: 'pop' }, h('div', { class: 'head', style: { padding: '.7rem .9rem' } }, h('strong', null, 'Notifications'), h('button', { class: 'btn sm ghost', onclick: async () => { await NH.post('/api/notifications/read', { all: true }); poll(); pop.remove(); pop = null; } }, 'Mark all read')),
        (NH._notes || []).length ? (NH._notes || []).slice(0, 25).map((n) => h('div', { class: 'it' + (n.read ? '' : ' un'), onclick: async () => { await NH.post('/api/notifications/read', { ids: [n.id] }); pop.remove(); pop = null; poll(); if (n.link) go(n.link.replace(/^#/, '')); } }, h('div', { class: 'bold' }, n.title), h('div', { class: 'small muted' }, n.body), h('div', { class: 'small muted' }, ago(n.at)))) : empty('No notifications yet', 'bell'));
      bell.append(pop);
    };
    document.addEventListener('click', (e) => { if (pop && !bell.contains(e.target)) { pop.remove(); pop = null; } });
    poll(); clearInterval(NH._poll); NH._poll = setInterval(poll, 30000);
  }
  async function signOut() { try { await NH.post('/api/auth/logout'); } catch { /* ignore */ } NH.user = null; NH.csrf = null; clearInterval(NH._poll); location.hash = ''; start(); }

  /* ---------- public / sign-in screens ---------- */
  const legalLinks = () => h('div', { class: 'small', style: { textAlign: 'center', marginTop: '.8rem' } }, h('a', { href: '#/about' }, 'What is Jasmyle?'), ' · ', h('a', { href: '#/buy' }, 'Homes for sale'), ' · ', h('a', { href: '#/services' }, 'Find a professional'), h('br'), h('a', { href: '#/terms' }, 'Terms & Conditions'), ' · ', h('a', { href: '#/privacy' }, 'Privacy Notice'));
  function authLayout(content) {
    return h('div', { class: 'auth' },
      h('div', { class: 'art' }, h('div', { class: 'row' }, logo(), h('strong', { style: { fontSize: '1.3rem' } }, 'Jasmyle Properties')), h('h1', null, 'The whole real-estate journey, in one place.'),
        h('p', null, 'Find, rent, buy, sell, manage and maintain property in Kenya. Rent by M-Pesa, PayPal, card or bank; sales and land with verified listings; short stays, projects, licences and trusted professionals - from your phone or computer.'),
        h('ul', null, h('li', null, 'Rentals: invoices, reminders, receipts, repairs, tax'), h('li', null, 'Sales, land, leads and commission tracking'), h('li', null, 'Clear roles and strong data protection (Kenya Data Protection Act, 2019)'))),
      h('div', { class: 'form' }, h('div', { class: 'box' }, content, legalLinks())));
  }
  function loginScreen(adminMode) {
    const supportBox = h('div', { class: 'stack' });
    api('GET', '/api/public/config', undefined, { quiet: true }).then((c) => { if (c.announcement) supportBox.append(h('div', { class: 'note ' + (c.announcement.level === 'bad' ? 'bad' : c.announcement.level === 'warn' ? 'warn' : '') }, c.announcement.text)); const s = c.support || {}; if (s.phone || s.email || s.whatsapp) supportBox.append(h('p', { class: 'small muted' }, 'Need help? ' + [s.phone && 'Call ' + s.phone, s.whatsapp && 'WhatsApp ' + s.whatsapp, s.email].filter(Boolean).join(' · '))); }).catch(() => {});
    const err = h('div', { class: 'err hide' }); const id = h('input', { type: 'text', autocomplete: 'username', placeholder: 'Email or phone number', autofocus: true });
    const pw = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Password' }); const code = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', placeholder: '6-digit code or recovery code' });
    const codeBox = h('div', { class: 'f' + (adminMode ? '' : ' hide') }, h('label', null, 'Verification code' + (adminMode ? ' (from your authenticator app)' : '')), code, h('div', { class: 'hint' }, 'Open your authenticator app (Google Authenticator, Microsoft Authenticator or Authy) and type the current code.'));
    const btn = h('button', { class: 'btn lg block', type: 'submit' }, 'Sign in');
    const f = h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault(); err.classList.add('hide'); btn.disabled = true;
      try {
        const r = await api('POST', '/api/auth/login', { identifier: id.value, password: pw.value, code: code.value || undefined }, { quiet: true });
        if (r.needs2fa) { codeBox.classList.remove('hide'); code.focus(); return; }
        NH.user = r; NH.csrf = r.csrf; try { history.replaceState(null, '', '#/'); } catch { /* ignore */ } await afterLogin();
      } catch (ex) { err.textContent = ex.message; err.classList.remove('hide'); } finally { btn.disabled = false; }
    } }, h('h2', { style: { fontSize: '1.5rem' } }, adminMode ? 'National Administrator sign-in' : 'Welcome back'),
    h('p', { class: 'muted' }, adminMode ? 'Approve new landlords, verify properties and manage the platform. The first time, enter the password you chose during setup - you will then be asked to turn on two-factor protection.' : 'Sign in to manage or pay your rent. Landlords, managers, caretakers, tenants and National Administrators all sign in here.'), err,
    h('div', { class: 'f' }, h('label', null, 'Email or phone'), id), h('div', { class: 'f' }, h('label', null, 'Password'), pw), codeBox, btn,
    h('div', { class: 'row between small' }, h('a', { href: '#/find' }, icon('search'), ' Looking for a house?'), h('a', { href: '#/register' }, 'Landlord? Register')),
    adminMode ? h('a', { class: 'small', href: '#/' }, 'Not an administrator? Normal sign-in') : h('a', { class: 'small', href: '#/admin-login' }, 'National Administrator? Sign in here'),
    h('p', { class: 'small muted' }, 'Forgot your password? Tenants and staff: ask your landlord or manager to reset it. Landlords: contact National Administration.'), supportBox);
    return authLayout(f);
  }
  function setupScreen(here, needToken) {
    if (!here && !needToken) return authLayout(h('div', { class: 'stack' }, h('h2', { style: { fontSize: '1.5rem' } }, 'Jasmyle Properties is installed'), h('div', { class: 'note warn' }, 'First-time setup has not been done yet. For safety it can only be completed on the computer that runs Jasmyle Properties.'), h('p', null, 'On that computer, open a browser and go to:'), h('div', { class: 'note', style: { fontFamily: 'ui-monospace,monospace' } }, 'http://localhost:' + (location.port || '8080')), h('p', { class: 'small muted' }, 'Then create the National Administrator account. After that, everyone can use this page. (On a cloud server, set the NH_SETUP_TOKEN secret to allow setup from this browser.)')));
    const f = form([{ name: 'name', label: 'Your full name', required: true }, { name: 'email', label: 'Your email (this is your sign-in name)', type: 'email', required: true }, { name: 'phone', label: 'Phone number (optional)', type: 'tel', placeholder: '0712 345 678' }, { name: 'password', label: 'Choose a password', type: 'password', required: true, hint: 'At least 10 characters with 3 of: lowercase, UPPERCASE, numbers, symbols. Do not use your name.', full: true }, { name: 'password2', label: 'Repeat the password', type: 'password', required: true, full: true }].concat(needToken ? [{ name: 'setupToken', label: 'Setup code (the NH_SETUP_TOKEN you set on the server)', type: 'password', required: true, full: true }] : []));
    const err = h('div', { class: 'err hide' }); const btn = h('button', { class: 'btn lg block' }, 'Create administrator account');
    btn.onclick = async () => {
      err.classList.add('hide'); const v = f.values();
      if (v.password !== v.password2) { err.textContent = 'The two passwords are not the same'; err.classList.remove('hide'); return; }
      btn.disabled = true;
      try {
        await api('POST', '/api/public/first-admin', { name: v.name, email: v.email, phone: v.phone, password: v.password, setupToken: v.setupToken }, { quiet: true });
        const r = await api('POST', '/api/auth/login', { identifier: v.email, password: v.password }, { quiet: true });
        NH.user = r; NH.csrf = r.csrf; try { history.replaceState(null, '', '#/'); } catch { /* ignore */ } toast('Administrator account created', 'ok'); await afterLogin();
      } catch (ex) { err.textContent = ex.message; err.classList.remove('hide'); } finally { btn.disabled = false; }
    };
    return authLayout(h('div', { class: 'stack' }, h('h2', { style: { fontSize: '1.5rem' } }, 'Welcome to Jasmyle Properties'), h('div', { class: 'note' }, 'First-time setup: create the National Administrator account. You will approve new landlords and manage the whole system with it.'), err, f.el, btn));
  }
  function registerScreen() {
    const f = form([{ name: 'name', label: 'Your full name', required: true }, { name: 'company', label: 'Company / business name (optional)' }, { name: 'email', label: 'Email', type: 'email', required: true }, { name: 'phone', label: 'Phone (M-Pesa number)', type: 'tel', required: true, placeholder: '0712 345 678' }, { name: 'county', label: 'County', required: true }, { name: 'town', label: 'Town / area' }, { name: 'password', label: 'Password', type: 'password', required: true, hint: 'At least 10 characters with 3 of: lowercase, UPPERCASE, numbers, symbols.', full: true }]);
    const err = h('div', { class: 'err hide' }); const btn = h('button', { class: 'btn lg block' }, 'Create landlord account');
    const agree = h('input', { type: 'checkbox' }); const agreeBox = h('label', { class: 'chk small' }, agree, h('span', null, 'I have read and accept the ', h('a', { href: '#/terms', target: '_blank' }, 'Terms & Conditions'), ' and the ', h('a', { href: '#/privacy', target: '_blank' }, 'Privacy Notice'), ' (Data Protection Act, 2019).'));
    btn.onclick = async () => { err.classList.add('hide'); if (!agree.checked) { err.textContent = 'Please accept the Terms & Conditions and the Privacy Notice to continue.'; err.classList.remove('hide'); return; } btn.disabled = true; try { const r = await api('POST', '/api/auth/register-landlord', { ...f.values(), acceptTerms: true }, { quiet: true }); clear(box).append(h('div', { class: 'stack' }, h('h2', null, 'Thank you!'), h('div', { class: 'note ok' }, r.message), h('a', { class: 'btn', href: '#/' }, 'Back to sign in'))); } catch (ex) { err.textContent = ex.message; err.classList.remove('hide'); } finally { btn.disabled = false; } };
    const box = h('div', { class: 'stack' }, h('h2', { style: { fontSize: '1.5rem' } }, 'Register as a landlord'), h('p', { class: 'muted' }, 'National Administration reviews every new landlord before activation.'), err, f.el, agreeBox, btn, h('a', { href: '#/' }, 'Already have an account? Sign in'));
    return authLayout(box);
  }
  NH.publicRoutesReady = false;

  function forcedPassword() {
    const cur = h('input', { type: 'password', autocomplete: 'current-password' }); const nw = h('input', { type: 'password', autocomplete: 'new-password' }); const nw2 = h('input', { type: 'password', autocomplete: 'new-password' });
    const err = h('div', { class: 'err hide' }); const btn = h('button', { class: 'btn lg block' }, 'Save new password');
    btn.onclick = async () => {
      err.classList.add('hide');
      if (nw.value !== nw2.value) { err.textContent = 'The two new passwords are not the same'; err.classList.remove('hide'); return; }
      btn.disabled = true;
      try { await api('POST', '/api/auth/change-password', { current: cur.value, next: nw.value }, { quiet: true }); toast('Password changed', 'ok'); const me = await api('GET', '/api/me'); NH.user = me.user; NH.csrf = me.user.csrf; await afterLogin(); } catch (ex) { err.textContent = ex.message; err.classList.remove('hide'); } finally { btn.disabled = false; }
    };
    return authLayout(h('div', { class: 'stack' }, h('h2', { style: { fontSize: '1.5rem' } }, 'Choose your own password'), h('div', { class: 'note warn' }, 'You are using a temporary password. For your security, please choose a new one now.'), err,
      h('div', { class: 'f' }, h('label', null, 'Temporary / current password'), cur), h('div', { class: 'f' }, h('label', null, 'New password'), nw, h('div', { class: 'hint' }, 'At least 10 characters, with 3 of: lowercase, UPPERCASE, numbers, symbols. Do not use your name or common words.')), h('div', { class: 'f' }, h('label', null, 'Repeat new password'), nw2), btn, h('button', { class: 'btn line block', onclick: signOut }, 'Cancel and sign out')));
  }
  function qrBox(text) {
    const d = h('div', { style: { background: '#fff', padding: '8px', borderRadius: '10px', width: 'fit-content', border: '1px solid #dbe3f0', margin: '0 auto' } });
    try { d.innerHTML = window.NH_QR.svg(text, { size: 208 }); const sv = d.querySelector('svg'); sv.style.cssText = 'width:208px;height:208px;max-width:100%;display:block'; } catch { d.textContent = 'QR code unavailable - use the setup key below.'; }
    return d;
  }
  function mfaPanel(onDone, forced) {
    const box = h('div', { class: 'stack' });
    const start1 = () => {
      const pw = h('input', { type: 'password', autocomplete: 'current-password' }); const err = h('div', { class: 'err hide' });
      clear(box).append(h('h3', null, 'Step 1 of 2: confirm it is you'), h('div', { class: 'f' }, h('label', null, 'Your password'), pw), err, h('button', { class: 'btn', onclick: async (e) => { err.classList.add('hide'); try { const r = await api('POST', '/api/auth/2fa/setup', { password: pw.value }, { quiet: true }); step2(r); } catch (ex) { err.textContent = ex.message; err.classList.remove('hide'); } } }, 'Continue'));
    };
    const step2 = (r) => {
      const code = h('input', { type: 'text', inputmode: 'numeric', maxlength: 8, placeholder: '123456' }); const err = h('div', { class: 'err hide' });
      clear(box).append(h('h3', null, 'Step 2 of 2: add to your phone'), h('ol', { class: 'small' }, h('li', null, 'Install Google Authenticator, Microsoft Authenticator or Authy on your phone.'), h('li', null, 'Choose "Add account" and scan this QR code with your phone camera:')),
        qrBox(r.uri),
        h('div', { class: 'small muted' }, 'Cannot scan? Type this setup key instead:'),
        h('div', { class: 'note', style: { fontFamily: 'ui-monospace,monospace', fontSize: '1.15rem', letterSpacing: '.08em', wordBreak: 'break-all' } }, r.secret.match(/.{1,4}/g).join(' ')),
        h('div', { class: 'row' }, h('button', { class: 'btn ghost sm', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(r.secret); toast('Key copied', 'ok'); } }, 'Copy key'), h('a', { class: 'btn ghost sm', href: r.uri }, 'Open in authenticator app')),
        h('div', { class: 'f' }, h('label', null, 'Type the 6-digit code now showing in the app'), code), err,
        h('button', { class: 'btn', onclick: async () => { err.classList.add('hide'); try { const d = await api('POST', '/api/auth/2fa/enable', { code: code.value }, { quiet: true }); done(d.recoveryCodes); } catch (ex) { err.textContent = ex.message; err.classList.remove('hide'); } } }, 'Turn on two-factor protection'));
    };
    const done = (codes) => clear(box).append(h('h3', null, 'Two-factor protection is ON'), h('div', { class: 'note warn' }, 'Save these one-time recovery codes somewhere safe (not on the same phone). Each works once if you lose your phone. They are shown only now.'),
      h('div', { class: 'card', style: { fontFamily: 'ui-monospace,monospace', columns: 2, fontSize: '1.05rem' } }, codes.map((c) => h('div', null, c))), h('button', { class: 'btn', onclick: async () => { const me = await api('GET', '/api/me'); NH.user = me.user; onDone(); } }, 'I have saved them - continue'));
    start1(); return box;
  }
  function forcedMfa() {
    return authLayout(h('div', { class: 'stack' }, h('h2', { style: { fontSize: '1.5rem' } }, 'Secure your administrator account'), h('div', { class: 'note warn' }, 'National Administrators must use two-factor authentication. It takes one minute.'), mfaPanel(() => afterLogin(), true), h('button', { class: 'btn line block', onclick: signOut }, 'Sign out')));
  }

  function legalGate() {
    const box = h('div', { class: 'stack' }); const agree = h('input', { type: 'checkbox' }); const err = h('div', { class: 'err hide' });
    const btn = h('button', { class: 'btn lg block' }, 'Accept and continue');
    api('GET', '/api/public/legal', undefined, { quiet: true }).then((d) => {
      btn.onclick = async () => { err.classList.add('hide'); if (!agree.checked) { err.textContent = 'Please tick the box to continue.'; err.classList.remove('hide'); return; } btn.disabled = true; try { await api('POST', '/api/me/accept-legal', { version: d.version, accept: true }, { quiet: true }); NH.user.legalAccepted = true; await afterLogin(); } catch (ex) { err.textContent = ex.message; err.classList.remove('hide'); } finally { btn.disabled = false; } };
    });
    box.append(h('h2', { style: { fontSize: '1.5rem' } }, 'Terms & Privacy Notice'), h('div', { class: 'note' }, 'Before you continue, please read and accept our Terms & Conditions and Privacy Notice. They explain how Jasmyle Properties works, your duties, and how your personal data is protected under the Kenya Data Protection Act, 2019.'),
      h('div', { class: 'row' }, h('a', { class: 'btn ghost', href: '#/terms', target: '_blank' }, 'Read the Terms'), h('a', { class: 'btn ghost', href: '#/privacy', target: '_blank' }, 'Read the Privacy Notice')),
      err, h('label', { class: 'chk' }, agree, h('span', null, 'I have read and accept the Terms & Conditions and the Privacy Notice.')), btn, h('button', { class: 'btn line block', onclick: signOut }, 'Sign out'));
    return authLayout(box);
  }
  async function afterLogin() {
    const u = NH.user;
    if (u.mustChangePassword) return clear($('#app')).append(forcedPassword());
    if (u.mfaRequired && !u.mfaEnabled) return clear($('#app')).append(forcedMfa());
    if (u.legalAccepted === false) return clear($('#app')).append(legalGate());
    shell(); await renderRoute();
  }
  NH.mfaPanel = mfaPanel;

  const PUBLIC_RE = /^\/(find|home\/|listing\/|saved|compare|track\/|alert-stop\/|passport\/|about|terms|privacy(\/|$)|buy|sale\/|services|data-request)/;
  function publicShell() {
    return h('div', null, h('div', { class: 'pubbar' }, h('a', { class: 'brand', href: '#/find' }, logo(), h('span', null, 'Jasmyle ', h('small', null, 'Properties'))), h('div', { class: 'grow' }),
      h('a', { href: '#/find' }, 'Rent'), h('a', { href: '#/buy' }, 'Buy'), h('a', { href: '#/services' }, 'Services'), h('a', { href: '#/about' }, 'About'), h('a', { class: 'btn sm', style: { background: '#fff', color: 'var(--b8)' }, href: '#/' }, 'Sign in')),
      h('div', { class: 'content' }, NH.publicView),
      h('footer', { class: 'pubfoot' }, h('div', null, '© ', new Date().getFullYear(), ' Jasmyle Properties'), h('div', null, h('a', { href: '#/about' }, 'About'), ' · ', h('a', { href: '#/terms' }, 'Terms & Conditions'), ' · ', h('a', { href: '#/privacy' }, 'Privacy Notice'), ' · ', h('a', { href: '#/data-request' }, 'Your data rights'))));
  }
  NH.legalLinks = legalLinks;
  async function start() {
    try { const me = await api('GET', '/api/me', undefined, { quiet: true }); if (me.user) { NH.user = me.user; NH.csrf = me.user.csrf; } } catch { /* offline */ }
    if (NH.user) return afterLogin();
    // public area
    const p = parseHash().path;
    const root = clear($('#app'));
    if (PUBLIC_RE.test(p)) { NH.publicView = h('div', null); root.append(publicShell()); return renderRoute(); }
    let st = null; try { st = await api('GET', '/api/public/setup-status', undefined, { quiet: true }); } catch { /* ignore */ }
    if (st && st.needsSetup) return root.append(setupScreen(st.canSetupHere, st.setupTokenRequired));
    root.append(p.startsWith('/register') ? registerScreen() : loginScreen(p.startsWith('/admin-login')));
  }
  window.addEventListener('hashchange', () => { if (!NH.user) start(); });
  NH.start = start; NH.signOut = signOut; NH.afterLogin = afterLogin;
  document.addEventListener('DOMContentLoaded', () => { if (window.NH_VIEWS_READY) start(); });
})();
