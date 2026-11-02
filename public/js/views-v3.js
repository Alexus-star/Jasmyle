'use strict';
/* Utilities (meter readings and billing) and CSV import. */
(function () {
  const { h, icon, money, route } = NH;
  const { card, empty, pageHead, table, toast, modal, busy } = NH.ui;
  const note = (cls, ...c) => h('div', { class: 'note ' + cls }, ...c);
  const field = (label, inp, hint) => h('div', { class: 'f' }, h('label', null, label), inp, hint ? h('div', { class: 'hint' }, hint) : null);
  const sel = (opts, v) => h('select', null, opts.map(([k, l]) => h('option', { value: k, selected: String(k) === String(v) }, l)));
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const UT = [['water', 'Water'], ['electricity', 'Electricity']];

  /* ---------- utilities ---------- */
  route('/utilities', async (p, q) => {
    NH.title('Utilities');
    const props = (await NH.get('/api/properties')).properties;
    if (!props.length) return h('div', { class: 'stack' }, pageHead('Water & electricity'), card(empty('Add a property first.', 'building')));
    const state = { propertyId: q.propertyId || props[0].id, utility: 'water', period: NH.thisMonth() };
    const root = h('div', { class: 'stack' });
    const body = h('div', { class: 'stack' });
    const propSel = sel(props.map((x) => [x.id, x.name]), state.propertyId); const utSel = sel(UT, 'water');
    const month = h('input', { type: 'month', value: state.period, max: NH.thisMonth() });
    const load = async () => {
      state.propertyId = propSel.value; state.utility = utSel.value; state.period = month.value || NH.thisMonth();
      NH.clear(body).append(h('div', { class: 'spin' }));
      try { NH.clear(body).append(sheet(await NH.get(`/api/utilities/sheet?propertyId=${state.propertyId}&utility=${state.utility}&period=${state.period}`))); } catch (e) { NH.clear(body).append(note('bad', e.message)); }
    };
    [propSel, utSel, month].forEach((x) => { x.onchange = load; });
    root.append(pageHead('Water & electricity'), card(h('div', { class: 'row' }, field('Property', propSel), field('Utility', utSel), field('Month', month))), body);
    load();
    return root;

    function sheet(d) {
      const t = d.tariff; const unit = t.unit; const inputs = new Map(); const out = h('div', { class: 'stack' });
      const usageCell = new Map(); const amtCell = new Map();
      const calc = (row) => {
        const inp = inputs.get(row.unitId); const v = inp.cur.value === '' ? null : Number(inp.cur.value);
        const prev = inp.reset.checked && inp.prev.value !== '' ? Number(inp.prev.value) : row.previous;
        const u = usageCell.get(row.unitId); const a = amtCell.get(row.unitId);
        if (v === null || prev === null) { u.textContent = prev === null && v !== null ? 'Starting point' : '-'; if (a) a.textContent = '-'; return; }
        const used = r3(v - prev);
        if (used < 0) { u.textContent = 'Lower than last'; u.className = 'red'; if (a) a.textContent = '-'; return; }
        u.textContent = used + ' ' + unit; u.className = row.avgUnits && used > 3 * row.avgUnits && used > 5 ? 'red bold' : '';
        if (row.avgUnits && used > 3 * row.avgUnits && used > 5) u.textContent += ' (high!)';
        if (a) a.textContent = d.canBill && t.enabled ? money(used * t.rate + t.fixed) : '-';
      };
      const rows = d.rows.map((row) => {
        const locked = row.reading && row.reading.billed;
        const cur = h('input', { type: 'number', step: 'any', min: 0, value: row.reading ? row.reading.current : '', disabled: locked, style: { width: '8rem' }, 'aria-label': 'Reading for ' + row.unitName, oninput: () => calc(row) });
        const reset = h('input', { type: 'checkbox', disabled: locked, onchange: () => { prev.classList.toggle('hide', !reset.checked); calc(row); } });
        const prev = h('input', { type: 'number', step: 'any', min: 0, class: 'hide', placeholder: 'opening', style: { width: '6rem' }, oninput: () => calc(row) });
        inputs.set(row.unitId, { cur, reset, prev });
        usageCell.set(row.unitId, h('span')); if (d.canBill) amtCell.set(row.unitId, h('span'));
        return { row, cur, reset, prev, locked };
      });
      const tbl = h('div', { class: 'tw' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, ['Unit', 'Last reading', 'This reading (' + unit + ' meter)', 'New meter?', 'Used', ...(d.canBill ? ['Bill'] : []), 'Status'].map((x) => h('th', null, x)))),
        h('tbody', null, rows.map(({ row, cur, reset, prev, locked }) => h('tr', null,
          h('td', null, h('b', null, row.unitName), h('div', { class: 'small muted' }, row.tenantName)),
          h('td', null, row.previous === null ? h('span', { class: 'muted small' }, 'none yet') : String(row.previous)),
          h('td', null, cur), h('td', null, h('div', { class: 'row', style: { gap: '.4rem' } }, reset, prev)),
          h('td', null, usageCell.get(row.unitId)), d.canBill ? h('td', null, amtCell.get(row.unitId)) : null,
          h('td', null, locked ? NH.badge('Billed' + (d.canBill && row.reading.amount ? ' ' + money(row.reading.amount) : ''), 'ok') : row.reading ? NH.badge('Recorded', '') : h('span', { class: 'muted small' }, '-')))))));
      rows.forEach(({ row }) => calc(row));
      const gather = () => rows.filter((x) => !x.locked && x.cur.value !== '').map(({ row, cur, reset, prev }) => ({ unitId: row.unitId, current: Number(cur.value), reset: reset.checked || undefined, previous: reset.checked && prev.value !== '' ? Number(prev.value) : undefined }));
      const save = (bill) => (e) => busy(e.currentTarget, async () => {
        const readings = gather(); if (!readings.length) return toast('Type at least one reading', 'bad');
        const r = await NH.post('/api/utilities/readings', { propertyId: state.propertyId, utility: state.utility, period: state.period, bill, readings });
        const bad = r.results.filter((x) => x.error);
        const warn = r.results.filter((x) => x.warning).length;
        toast(`${r.saved} reading(s) saved` + (bill ? ' and billed' : '') + (warn ? `, ${warn} look unusually high` : '') + (bad.length ? `. ${bad.length} not saved: ${bad.slice(0, 2).map((x) => (d.rows.find((y) => y.unitId === x.unitId) || {}).unitName + ' - ' + x.error).join('; ')}` : ''), bad.length ? 'bad' : 'ok');
        load();
      });
      out.append(
        !t.enabled ? note('warn', `${t.label} billing is switched off for this property.`, d.canSetRates ? ' Set the rate to start billing; you can still record readings.' : ' Ask the landlord to set the rate. You can still record readings.') : d.canBill ? note('', `${t.label}: KES ${t.rate} per ${unit}` + (t.fixed ? ` + KES ${t.fixed} fixed each month` : '') + `. Bills are due ${t.dueDays} days after they are issued.`) : null,
        d.rows.length ? card(tbl) : card(empty('No occupied units in this property.', 'building')),
        d.rows.length ? h('div', { class: 'row' }, h('button', { class: 'btn line', onclick: save(false) }, 'Save readings'), d.canBill && t.enabled ? h('button', { class: 'btn', onclick: save(true) }, 'Save & bill tenants') : null, d.canBill && t.enabled ? h('button', { class: 'btn ghost', title: 'Bill readings a caretaker already saved', onclick: (e) => busy(e.currentTarget, async () => { const r = await NH.post('/api/utilities/bill', { propertyId: state.propertyId, utility: state.utility, period: state.period }); toast(r.billed ? `${r.billed} bill(s) issued, ${money(r.total)} in total` : 'Nothing new to bill', r.billed ? 'ok' : ''); load(); }) }, 'Bill saved readings') : null, d.canSetRates ? h('button', { class: 'btn ghost', onclick: () => ratesForm(d) }, 'Rates') : null) : null,
        h('p', { class: 'small muted' }, 'The first reading you enter for a unit is only its starting point. Bills begin from the next month. If a meter was replaced, tick "New meter" and type the new meter\'s opening number.'));
      return out;
    }
    function ratesForm(d) {
      const mk = (k, label, unit) => { const t = d.tariffs[k]; const on = h('input', { type: 'checkbox', checked: t.enabled }); const rate = h('input', { type: 'number', step: 'any', min: 0, value: t.rate || '' }); const fixed = h('input', { type: 'number', step: 'any', min: 0, value: t.fixed || '' }); const days = h('input', { type: 'number', min: 1, max: 60, value: t.dueDays });
        return { k, on, rate, fixed, days, el: h('div', { class: 'card stack' }, h('label', { class: 'chk' }, on, h('b', null, 'Bill ' + label.toLowerCase())), h('div', { class: 'form-grid' }, field(`Rate per ${unit} (KES)`, rate), field('Fixed monthly charge (KES, optional)', fixed, 'e.g. a service or garbage fee'), field('Days to pay', days))) }; };
      const items = [mk('water', 'Water', 'm³'), mk('electricity', 'Electricity', 'kWh')];
      modal('Rates for ' + d.property.name, h('div', { class: 'stack' }, note('', 'Rates apply to the next bill you issue. Bills already issued do not change.'), items.map((i) => i.el)), { actions: (close) => [h('button', { class: 'btn line', onclick: close }, 'Cancel'), h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, async () => { const b = {}; for (const i of items) b[i.k] = { enabled: i.on.checked, rate: Number(i.rate.value || 0), fixed: Number(i.fixed.value || 0), dueDays: Number(i.days.value || 7) }; await NH.put(`/api/properties/${state.propertyId}/tariffs`, b); close(); toast('Rates saved', 'ok'); load(); }) }, 'Save rates')] });
    }
  }, { title: 'Utilities' });

  /* ---------- CSV import ---------- */
  const safeCell = (v) => { v = String(v ?? ''); if (/^[=+\-@\t\r]/.test(v)) v = "'" + v; return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  function download(name, text) { const a = h('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: name }); document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); }

  route('/import', async (p, q) => {
    NH.title('Import');
    const kinds = [['units', 'Units']].concat(NH.can('tenant.write') && NH.can('lease.write') ? [['tenants', 'Tenants (with lease)']] : []);
    const props = (await NH.get('/api/properties')).properties;
    let kind = q.kind === 'tenants' && kinds.length > 1 ? 'tenants' : 'units';
    const root = h('div', { class: 'stack' }); const body = h('div', { class: 'stack' });
    const paint = () => NH.clear(body).append(panel());
    root.append(pageHead('Import from a spreadsheet'), NH.tabs(kinds, kind, (k) => { kind = k; paint(); }), body);
    paint(); return root;

    function panel() {
      let csv = ''; const out = h('div', { class: 'stack' });
      const area = h('textarea', { rows: 6, placeholder: 'Or paste the rows here (include the header row)', style: { width: '100%', fontFamily: 'ui-monospace,monospace' }, oninput: () => { csv = area.value; } });
      const file = h('input', { type: 'file', accept: '.csv,text/csv,text/plain', onchange: async () => { if (file.files[0]) { csv = await file.files[0].text(); area.value = csv.slice(0, 20000); toast(file.files[0].name + ' loaded', 'ok'); } } });
      const propSel = sel([['', props.length === 1 ? props[0].name : 'Use the "property" column in the file']].concat(props.map((x) => [x.id, x.name])), '');
      const opts = kind === 'tenants' ? { bill: h('input', { type: 'checkbox', checked: true }), dep: h('input', { type: 'checkbox', checked: true }) } : null;
      const body_ = () => ({ csv, propertyId: propSel.value || undefined, ...(opts ? { billFromThisMonth: opts.bill.checked, depositAlreadyPaid: opts.dep.checked } : {}) });
      const show = (r) => {
        NH.clear(out);
        out.append(note(r.failed ? 'warn' : 'ok', r.dryRun ? `Preview: ${r.ok} row(s) are ready, ${r.failed} need fixing. Nothing has been saved yet.` : `${r.created} ${kind === 'units' ? 'unit(s)' : 'tenant(s)'} added.` + (r.failed ? ` ${r.failed} row(s) were skipped (listed below). Fix them in your file and import again; rows already added are skipped automatically.` : '')));
        if (!r.dryRun && r.credentials && r.credentials.length) {
          out.append(note('warn', 'Temporary passwords are shown only now. Download the list and give each tenant their password (they must change it at first sign-in).'), h('button', { class: 'btn', onclick: () => download('jasmyle-tenant-logins.csv', ['row,name,phone,property,unit,temporary_password', ...r.credentials.map((c) => [c.row, c.name, NH.phone(c.phone), c.property, c.unit, c.tempPassword].map(safeCell).join(','))].join('\n')) }, icon('download'), 'Download logins (CSV)'));
        }
        out.append(card(table([{ h: 'Row', c: (x) => x.row }, { h: 'Item', c: (x) => x.label }, { h: 'Result', c: (x) => (x.status === 'ok' ? NH.badge(r.dryRun ? 'Ready' : 'Added', 'ok') : NH.badge('Problem', 'bad')) }, { h: 'Details', c: (x) => x.message || '' }], r.rows.slice(0, 500), { empty: 'No rows' })));
        if (r.dryRun && r.ok) out.append(h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, async () => { const ok = await NH.ui.confirmBox('Import ' + r.ok + ' row(s)?', kind === 'tenants' ? 'This creates tenant accounts and leases. Rows with problems are skipped.' : 'Rows with problems are skipped.', 'Import'); if (!ok) return; show(await NH.post('/api/import/' + kind, { ...body_(), dryRun: false })); }) }, `Import ${r.ok} row(s)`));
      };
      return h('div', { class: 'stack' },
        note('', kind === 'units' ? 'Columns: property, unit (required), type, bedrooms, rent (required), deposit, floor.' : 'Add the units first. Columns: unit, name, phone (required); property, email, national_id, move_in, rent, deposit, due_day, emergency_contact. Leave rent and deposit empty to use the unit\'s amounts.'),
        h('div', { class: 'row' }, h('a', { class: 'btn line sm', href: '/api/import/template?kind=' + kind }, icon('download'), 'Download template'), h('span', { class: 'small muted' }, 'Save your Excel sheet as CSV (Comma delimited) and choose it below.')),
        card(h('div', { class: 'stack' }, field('Choose a CSV file', file), area, field('Property', propSel, 'Used for rows that have no property column.'),
          opts ? h('div', { class: 'stack' }, h('label', { class: 'chk' }, opts.bill, 'Start billing rent from this month (do not back-bill earlier months)'), h('label', { class: 'chk' }, opts.dep, 'Deposits were already paid (do not invoice them)')) : null,
          h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, async () => { if (!csv.trim()) return toast('Choose a file or paste your rows first', 'bad'); show(await NH.post('/api/import/' + kind, { ...body_(), dryRun: true })); }) }, 'Check the file'))), out);
    }
  }, { title: 'Import' });
})();
