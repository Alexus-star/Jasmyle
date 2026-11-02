'use strict';
/* Landlord / manager / caretaker screens, part 1: properties, units, tenants, leases. */
(function () {
  const { h, icon, money, num, fdate, fdt, ago, route } = NH;
  const { card, stat, empty, pageHead, table, toast, modal, busy, confirmBox } = NH.ui;
  const opt = (arr) => arr.map((x) => (Array.isArray(x) ? x : [x, x]));

  /* ---------- properties ---------- */
  route('/properties', async (p, q) => {
    NH.title('Properties');
    const d = await NH.get('/api/properties');
    const node = h('div', { class: 'stack' });
    const addBtn = NH.can('property.create') ? h('button', { class: 'btn', onclick: () => propertyForm(null, d.amenityOptions) }, icon('plus'), 'Add property') : null;
    node.append(pageHead(NH.user.role === 'landlord' ? 'Properties' : 'My properties', addBtn));
    if (NH.user.role !== 'landlord') node.append(h('div', { class: 'note' }, 'You can only see the properties your landlord assigned to you.'));
    node.append(d.properties.length ? h('div', { class: 'grid auto' }, d.properties.map((pr) => h('div', { class: 'card stack', style: { cursor: 'pointer' }, onclick: () => NH.go('/properties/' + pr.id) },
      h('div', { class: 'head' }, h('h2', null, pr.name), pr.status === 'suspended' ? NH.badge('Suspended', 'bad') : pr.verified ? NH.badge('Verified', 'ok') : NH.badge('Awaiting verification', 'warn')), h('div', { class: 'muted' }, `${pr.town}, ${pr.county}`),
      h('div', { class: 'bar' }, h('i', { style: { width: pr.occupancy + '%' } })), h('div', { class: 'row between small' }, h('span', null, `${pr.occupied} of ${pr.unitCount} units occupied`), h('b', null, pr.occupancy + '%')), pr.vacant ? h('div', null, NH.badge(pr.vacant + ' vacant', 'warn')) : null))) : card(empty(NH.user.role === 'landlord' ? 'No properties yet. Add your first one.' : 'No properties have been assigned to you yet.', 'building')));
    if (q.new && addBtn) setTimeout(() => propertyForm(null, d.amenityOptions), 50);
    return node;
  }, { title: 'Properties' });

  function propertyForm(pr, amenities) {
    const full = !pr || NH.can('property.update');
    const fields = [];
    if (full) fields.push({ name: 'name', label: 'Property name', required: true, value: pr && pr.name }, { name: 'county', label: 'County', required: true, value: pr && pr.county }, { name: 'town', label: 'Town / area', required: true, value: pr && pr.town }, { name: 'address', label: 'Street / address', value: pr && pr.address });
    fields.push({ name: 'description', label: 'Description', type: 'textarea', value: pr && pr.description, hint: 'Shown to people searching for a home.' }, { name: 'amenities', label: 'Amenities', type: 'multi', options: amenities.map((a) => [a, a]), value: (pr && pr.amenities) || [] }, { name: 'rules', label: 'House rules (optional)', type: 'textarea', value: pr && pr.rules });
    const f = NH.form(fields);
    modal(pr ? 'Edit property' : 'Add property', h('div', { class: 'stack' }, pr && full && pr.verified ? h('div', { class: 'note warn' }, 'Changing the name or location removes the "Verified" status until National Administration checks it again.') : null, f.el), { actions: (close) => [h('button', { class: 'btn line', onclick: close }, 'Cancel'), h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, async () => { const v = f.values(); if (pr) { v.version = pr.version; await NH.put('/api/properties/' + pr.id, v); } else { const r = await NH.post('/api/properties', v); toast('Property added. Now add its units.', 'ok'); close(); return NH.go('/properties/' + r.property.id); } close(); toast('Saved', 'ok'); NH.refresh(); }) }, 'Save')] });
  }

  route('/properties/:id', async (p, q) => {
    const [d, un, list] = await Promise.all([NH.get('/api/properties/' + p.id), NH.get('/api/units?propertyId=' + p.id), NH.get('/api/properties')]);
    const pr = d.property; NH.title(pr.name);
    const units = un.units; const types = un.unitTypes;
    const node = h('div', { class: 'stack' });
    const editBtn = NH.canAny('property.update', 'property.update.basic') ? h('button', { class: 'btn line', onclick: () => propertyForm(pr, list.amenityOptions) }, 'Edit details') : null;
    node.append(h('a', { href: '#/properties', class: 'small' }, '← All properties'), pageHead(pr.name, editBtn, NH.can('property.archive') ? h('button', { class: 'btn line red', onclick: (e) => busy(e.currentTarget, async () => { if (await confirmBox('Archive property?', 'It disappears from your lists. Only possible when no tenants live there.', 'Archive', true)) { await NH.post(`/api/properties/${pr.id}/archive`); NH.go('/properties'); } }) }, 'Archive') : null));
    node.append(h('div', { class: 'grid g4' }, stat('Location', pr.town, pr.county), stat('Units', pr.unitCount, `${pr.occupied} occupied - ${pr.vacant} vacant`, 'blue'), stat('Occupancy', pr.occupancy + '%'), stat('Verification', pr.verified ? 'Verified' : 'Pending', pr.verified ? 'Visible in public search' : 'Not yet in public search', pr.verified ? '' : 'red')));
    if (pr.description || (pr.amenities || []).length) node.append(card(pr.description ? h('p', null, pr.description) : null, h('div', null, (pr.amenities || []).map((a) => h('span', { class: 'chip' }, a)))));
    if (d.staff.length) node.append(card(h('h2', null, 'People assigned here'), h('div', null, d.staff.map((s) => h('span', { class: 'chip' }, `${s.name} (${NH.ROLE[s.role]})`)))));
    const canUnit = NH.can('unit.write');
    const tools = h('div', { class: 'row' }, canUnit ? h('button', { class: 'btn', onclick: () => unitForm(pr, null, types) }, icon('plus'), 'Add unit') : null, canUnit ? h('button', { class: 'btn ghost', onclick: () => bulkForm(pr, types) }, 'Add many units') : null);
    node.append(card(h('div', { class: 'head' }, h('h2', null, 'Units'), tools), table([{ h: 'Unit', c: (u) => h('b', null, u.name) }, { h: 'Type', c: (u) => u.type }, { h: 'Rent', cls: 'num', c: (u) => money(u.rent) }, { h: 'Status', c: (u) => NH.stateBadge(u.status) }, { h: 'Tenant', c: (u) => u.tenantName || (u.status === 'vacant' && u.listed ? h('span', { class: 'badge ok' }, 'Listed for rent') : '-') },
      { h: '', c: (u) => canUnit ? h('div', { class: 'row' }, h('button', { class: 'btn sm ghost', onclick: (e) => { e.stopPropagation(); NH.listingMedia(u); } }, '📷 Photos'), h('button', { class: 'btn sm line', onclick: (e) => { e.stopPropagation(); unitForm(pr, u, types); } }, 'Edit')) : '' }], units, { empty: 'No units yet. Add the first one.', icon: 'building', onRow: (u) => (u.tenantId ? NH.go('/tenants/' + u.tenantId) : null) })));
    if (q.addunit && canUnit) setTimeout(() => unitForm(pr, null, types), 50);
    return node;
  }, { title: 'Property' });

  function unitForm(pr, u, types) {
    const f = NH.form([{ name: 'name', label: 'Unit name / number', required: true, value: u && u.name, placeholder: 'e.g. A1' }, { name: 'type', label: 'Type', type: 'select', options: opt(types), value: (u && u.type) || '1 Bedroom' }, { name: 'bedrooms', label: 'Bedrooms', type: 'number', value: u ? u.bedrooms : 1 }, { name: 'floor', label: 'Floor', value: u && u.floor }, { name: 'bathrooms', label: 'Bathrooms', type: 'number', value: u && u.bathrooms }, { name: 'furnished', label: 'Furnished', type: 'checkbox', value: u && u.furnished }, { name: 'availableFrom', label: 'Available from (optional)', type: 'date', value: u && u.availableFrom }, { name: 'tourUrl', label: 'Virtual tour / video link (YouTube, Vimeo, Matterport, Kuula)', value: u && u.tourUrl, placeholder: 'https://youtu.be/...' },
      { name: 'rent', label: 'Monthly rent (KES)', type: 'number', required: true, value: u && u.rent }, { name: 'deposit', label: 'Deposit (KES)', type: 'number', value: u ? u.deposit : '' }, { name: 'description', label: 'Description (shown in search)', type: 'textarea', value: u && u.description },
      ...(u && u.status !== 'occupied' ? [{ name: 'status', label: 'Status', type: 'select', options: [['vacant', 'Vacant'], ['maintenance', 'Under repairs (not available)']], value: u.status }] : []), ...(!u || u.status !== 'occupied' ? [{ name: 'listed', label: 'List this unit for rent in public search', type: 'checkbox', value: u && u.listed, hint: !pr.verified ? 'Only appears publicly once the property is verified.' : '' }] : [])]);
    modal(u ? 'Edit unit ' + u.name : 'Add unit', f.el, { actions: (close) => [h('button', { class: 'btn line', onclick: close }, 'Cancel'), u && u.status !== 'occupied' ? h('button', { class: 'btn line red', onclick: (e) => busy(e.currentTarget, async () => { if (await confirmBox('Remove unit?', 'The unit is archived.', 'Remove', true)) { await NH.post(`/api/units/${u.id}/archive`); close(); NH.refresh(); } }) }, 'Remove') : null,
      h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, async () => { const v = f.values(); if (u) { v.version = u.version; await NH.put('/api/units/' + u.id, v); } else { v.propertyId = pr.id; await NH.post('/api/units', v); } close(); toast('Saved', 'ok'); NH.refresh(); }) }, 'Save')] });
  }
  function bulkForm(pr, types) {
    const f = NH.form([{ name: 'prefix', label: 'Name prefix (optional)', placeholder: 'e.g. A- or Block B ' }, { name: 'from', label: 'First number', type: 'number', required: true, value: 1 }, { name: 'count', label: 'How many units', type: 'number', required: true, value: 10, hint: 'Up to 500 at once.' }, { name: 'type', label: 'Type', type: 'select', options: opt(types), value: '1 Bedroom' }, { name: 'bedrooms', label: 'Bedrooms', type: 'number', value: 1 }, { name: 'rent', label: 'Monthly rent (KES)', type: 'number', required: true }, { name: 'deposit', label: 'Deposit (KES)', type: 'number' }]);
    modal('Add many units', h('div', { class: 'stack' }, h('div', { class: 'note' }, 'Creates units named prefix + number, e.g. "A-1", "A-2"... All start vacant with the same rent. You can edit each later.'), f.el), { actions: (close) => [h('button', { class: 'btn line', onclick: close }, 'Cancel'), h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, async () => { const v = f.values(); v.propertyId = pr.id; const r = await NH.post('/api/units/bulk', v); close(); toast(`${r.created} unit(s) created` + (r.skipped.length ? `, ${r.skipped.length} skipped (already exist)` : ''), 'ok'); NH.refresh(); }) }, 'Create units')] });
  }

  /* ---------- tenants ---------- */
  route('/tenants', async (p, q) => {
    NH.title('Tenants');
    const [d, props] = await Promise.all([NH.get('/api/tenants?current=' + (q.all ? 'all' : 'current')), NH.get('/api/properties')]);
    const showBal = NH.can('rent.read'); let filter = ''; let prop = '';
    const holder = h('div'); const search = h('input', { type: 'search', placeholder: 'Search by name or phone' });
    const sel = h('select', null, h('option', { value: '' }, 'All properties'), props.properties.map((x) => h('option', { value: x.id }, x.name)));
    const paint = () => { const rows = d.tenants.filter((t) => (!filter || (t.name + t.phone).toLowerCase().includes(filter)) && (!prop || t.propertyId === prop)); NH.clear(holder).append(table([{ h: 'Tenant', c: (t) => h('div', null, h('b', null, t.name), h('div', { class: 'small muted' }, NH.phone(t.phone))) }, { h: 'Unit', c: (t) => h('div', null, t.unitName || '-', h('div', { class: 'small muted' }, t.propertyName)) }, ...(showBal ? [{ h: 'Balance', cls: 'num', c: (t) => (t.balance > 0 ? h('b', { class: 'red' }, money(t.balance)) : h('span', { class: 'green' }, 'Paid up')) }] : []), { h: 'Status', c: (t) => (t.tenancy === 'former' ? NH.badge('Moved out', 'gray') : NH.badge('Living here', 'ok')) }], rows, { empty: 'No tenants found', icon: 'users', onRow: NH.can('tenant.read') ? (t) => NH.go('/tenants/' + t.id) : null })); };
    search.oninput = () => { filter = search.value.toLowerCase(); paint(); }; sel.onchange = () => { prop = sel.value; paint(); }; paint();
    const addBtn = NH.can('tenant.write') && NH.can('lease.write') ? h('button', { class: 'btn', onclick: () => addTenant(props.properties) }, icon('plus'), 'Add tenant / move in') : null;
    if (q.new && addBtn) setTimeout(() => addTenant(props.properties), 50);
    return h('div', { class: 'stack' }, pageHead('Tenants', addBtn), !NH.can('tenant.read') ? h('div', { class: 'note' }, 'You can see tenant names, phone numbers and units only.') : null, card(h('div', { class: 'row', style: { marginBottom: '.8rem' } }, h('div', { class: 'grow' }, search), sel, h('a', { class: 'btn line sm', href: q.all ? '#/tenants' : '#/tenants?all=1' }, q.all ? 'Hide moved-out' : 'Include moved-out')), holder));
  }, { title: 'Tenants' });

  async function addTenant(properties, preset) {
    if (!properties.length) return toast('Add a property and units first', 'bad');
    const propSel = h('select', null, properties.map((x) => h('option', { value: x.id }, x.name)));
    const unitSel = h('select'); let units = [];
    async function loadUnits() { const d = await NH.get('/api/units?propertyId=' + propSel.value + '&status=vacant'); units = d.units; NH.clear(unitSel).append(...(units.length ? units.map((u) => h('option', { value: u.id }, `${u.name} - ${u.type} - ${money(u.rent)}`)) : [h('option', { value: '' }, 'No vacant units in this property')])); fillRent(); }
    const f = NH.form([{ name: 'name', label: 'Tenant full name', required: true }, { name: 'phone', label: 'Phone (M-Pesa)', type: 'tel', required: true, placeholder: '0712 345 678', hint: 'They sign in with this number.' }, { name: 'email', label: 'Email (optional)', type: 'email' }, { name: 'nationalId', label: 'ID / passport (optional)' },
      { name: 'startDate', label: 'Move-in date', type: 'date', required: true, value: NH.today() }, { name: 'dueDay', label: 'Rent due on day of month', type: 'number', value: 5, min: 1, max: 28 }, { name: 'rent', label: 'Monthly rent (KES)', type: 'number', required: true, hint: NH.can('lease.rent') ? '' : 'Set by the unit. Only the landlord can change it.' }, { name: 'deposit', label: 'Deposit (KES)', type: 'number' }, { name: 'endDate', label: 'Lease ends (optional)', type: 'date' }, { name: 'emergencyContact', label: 'Emergency contact (optional)', full: true }]);
    function fillRent() { const u = units.find((x) => x.id === unitSel.value); if (u) { f.set('rent', u.rent); f.set('deposit', u.deposit); } if (!NH.can('lease.rent')) { f.inputs.rent.inp.readOnly = true; f.inputs.deposit.inp.readOnly = true; } }
    propSel.onchange = loadUnits; unitSel.onchange = fillRent;
    const body = h('div', { class: 'stack' }, h('div', { class: 'form-grid' }, h('div', { class: 'f' }, h('label', null, 'Property'), propSel), h('div', { class: 'f' }, h('label', null, 'Vacant unit'), unitSel)), f.el);
    await loadUnits(); if (preset) { unitSel.value = preset; fillRent(); }
    modal('Add tenant / move in', body, { wide: true, actions: (close) => [h('button', { class: 'btn line', onclick: close }, 'Cancel'), h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, async () => { if (!unitSel.value) throw new Error('Choose a vacant unit'); const v = f.values(); v.unitId = unitSel.value; const r = await NH.post('/api/tenants', v); close(); NH.shareCredentials('Tenant added', r.tenant.name, NH.phone(r.tenant.phone), r.tempPassword, 'The first rent invoice has been created automatically.'); NH.go('/tenants/' + r.tenant.id); }) }, 'Move in')] });
  }

  route('/tenants/:id', async (p) => {
    const d = await NH.get('/api/tenants/' + p.id); const t = d.tenant; NH.title(t.name);
    const lease = d.leases.find((l) => l.status === 'active');
    const node = h('div', { class: 'stack' });
    const actions = [];
    if (NH.can('rent.collect') && lease) actions.push(h('button', { class: 'btn', onclick: () => recordPayment(t) }, icon('cash'), 'Record payment'));
    if (NH.can('rent.charge') && lease) actions.push(h('button', { class: 'btn ghost', onclick: () => addCharge(t) }, 'Add charge'));
    if (NH.canAny('chat.use')) actions.push(h('a', { class: 'btn line', href: '#/chat/' + t.id }, icon('chat'), 'Message'));
    node.append(h('a', { href: '#/tenants', class: 'small' }, '← All tenants'), pageHead(t.name, actions));
    if (t.phoneRequest && NH.can('tenant.write')) node.append(h('div', { class: 'note warn' }, h('b', null, t.name + ' asked to change their phone number to ' + NH.phone(t.phoneRequest.phone) + '. '), 'Approve only if you know it is really them.', h('div', { class: 'row', style: { marginTop: '.5rem' } }, h('button', { class: 'btn sm', onclick: (e) => busy(e.currentTarget, async () => { await NH.post(`/api/tenants/${t.id}/phone-request`, { accept: true }); toast('Phone number changed', 'ok'); NH.refresh(); }) }, 'Approve'), h('button', { class: 'btn sm red', onclick: (e) => busy(e.currentTarget, async () => { await NH.post(`/api/tenants/${t.id}/phone-request`, { accept: false }); NH.refresh(); }) }, 'Decline'))));
    node.append(h('div', { class: 'grid g4' }, stat('Balance owed', money(d.balance || 0), d.balance > 0 ? 'Needs follow-up' : 'Fully paid', d.balance > 0 ? 'red' : 'blue'), stat('Unit', t.unitName || '-', lease ? `Rent ${money(lease.rent)} due day ${lease.dueDay}` : 'Moved out'), stat('Phone', NH.phone(t.phone), t.email || ''), stat('Credit', money(lease ? lease.credit || 0 : 0), 'Advance payments held')));
    const infoBtns = h('div', { class: 'row' }, NH.can('tenant.write') ? h('button', { class: 'btn sm line', onclick: () => editTenant(t) }, 'Edit details') : null, NH.can('tenant.write') ? h('button', { class: 'btn sm line', onclick: (e) => busy(e.currentTarget, async () => { if (await confirmBox('Reset password?', `Create a new temporary password for ${t.name}. Their old password stops working.`, 'Reset')) { const r = await NH.post(`/api/tenants/${t.id}/reset-password`); NH.shareCredentials('New password', t.name, NH.phone(t.phone), r.tempPassword); } }) }, 'Reset password') : null,
      lease && NH.can('lease.terminate') ? h('button', { class: 'btn sm red', onclick: () => endLease(lease, t) }, 'Move out / end lease') : null, !lease && NH.can('lease.write') ? h('button', { class: 'btn sm', onclick: async () => { const pr = await NH.get('/api/properties'); addExisting(t, pr.properties); } }, 'New lease') : null);
    node.append(card(h('div', { class: 'head' }, h('h2', null, 'Details'), infoBtns), h('div', { class: 'grid g3 small' }, h('div', null, h('div', { class: 'muted' }, 'ID / passport'), h('b', null, t.nationalId || '-')), h('div', null, h('div', { class: 'muted' }, 'Emergency contact'), h('b', null, t.emergencyContact || '-')), h('div', null, h('div', { class: 'muted' }, 'Last sign-in'), h('b', null, t.lastLoginAt ? ago(t.lastLoginAt) : 'Never')))));
    if (d.invoices) {
      node.append(card(h('h2', null, 'Bills'), table([{ h: 'Item', c: (i) => h('div', null, i.desc, h('div', { class: 'small muted' }, i.number)) }, { h: 'Due', c: (i) => fdate(i.dueDate) }, { h: 'Amount', cls: 'num', c: (i) => money(i.amount) }, { h: 'Paid', cls: 'num', c: (i) => money(i.paid) }, { h: 'Status', c: (i) => NH.stateBadge(i.state) },
        { h: '', c: (i) => (i.state !== 'paid' && i.state !== 'void' && !i.paid && NH.can('rent.void') ? h('button', { class: 'btn sm line', onclick: (e) => busy(e.currentTarget, async () => { const r = prompt('Reason for cancelling this bill?'); if (r) { await NH.post(`/api/invoices/${i.id}/void`, { reason: r }); NH.refresh(); } }) }, 'Cancel bill') : '') }], d.invoices, { empty: 'No bills yet' })));
      node.append(card(h('h2', null, 'Payments'), table([{ h: 'Date', c: (x) => fdt(x.paidAt || x.createdAt) }, { h: 'Method', c: (x) => NH.METHOD[x.method] }, { h: 'Reference', c: (x) => x.providerRef || x.bankRef || '-' }, { h: 'Status', c: (x) => NH.stateBadge(x.status) }, { h: 'Amount', cls: 'num', c: (x) => money(x.amount) }], d.payments, { empty: 'No payments yet', onRow: (x) => paymentDetail(x) })));
    }
    node.append(card(h('h2', null, 'Rental history'), table([{ h: 'Unit', c: (l) => l.unitName }, { h: 'From', c: (l) => fdate(l.startDate) }, { h: 'To', c: (l) => (l.endDate ? fdate(l.endDate) : 'Ongoing') }, { h: 'Rent', cls: 'num', c: (l) => money(l.rent) }, { h: 'Status', c: (l) => NH.stateBadge(l.status) }], d.leases)));
    return node;
  }, { title: 'Tenant' });

  function editTenant(t) {
    const f = NH.form([{ name: 'name', label: 'Full name', required: true, value: t.name }, { name: 'phone', label: 'Phone', type: 'tel', required: true, value: NH.phone(t.phone) }, { name: 'email', label: 'Email', type: 'email', value: t.email }, { name: 'nationalId', label: 'ID / passport', value: t.nationalId }, { name: 'emergencyContact', label: 'Emergency contact', value: t.emergencyContact, full: true }]);
    modal('Edit tenant', f.el, { actions: (close) => [h('button', { class: 'btn line', onclick: close }, 'Cancel'), h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, async () => { const v = f.values(); v.version = t.version; await NH.put('/api/tenants/' + t.id, v); close(); toast('Saved', 'ok'); NH.refresh(); }) }, 'Save')] });
  }
  async function addExisting(t, properties) {
    const propSel = h('select', null, properties.map((x) => h('option', { value: x.id }, x.name))); const unitSel = h('select'); let units = [];
    const f = NH.form([{ name: 'startDate', label: 'Start date', type: 'date', required: true, value: NH.today() }, { name: 'dueDay', label: 'Rent due day', type: 'number', value: 5 }, { name: 'rent', label: 'Rent', type: 'number', required: true }, { name: 'deposit', label: 'Deposit', type: 'number' }]);
    const fill = () => { const u = units.find((x) => x.id === unitSel.value); if (u) { f.set('rent', u.rent); f.set('deposit', u.deposit); } };
    async function load() { units = (await NH.get('/api/units?propertyId=' + propSel.value + '&status=vacant')).units; NH.clear(unitSel).append(...units.map((u) => h('option', { value: u.id }, `${u.name} - ${money(u.rent)}`))); fill(); }
    propSel.onchange = load; unitSel.onchange = fill; await load();
    modal('New lease for ' + t.name, h('div', { class: 'stack' }, h('div', { class: 'form-grid' }, h('div', { class: 'f' }, h('label', null, 'Property'), propSel), h('div', { class: 'f' }, h('label', null, 'Vacant unit'), unitSel)), f.el), { actions: (close) => [h('button', { class: 'btn line', onclick: close }, 'Cancel'), h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, async () => { const v = f.values(); v.tenantId = t.id; v.unitId = unitSel.value; await NH.post('/api/leases', v); close(); NH.refresh(); }) }, 'Create lease')] });
  }
  function endLease(lease, t) {
    const f = NH.form([{ name: 'endDate', label: 'Move-out date', type: 'date', required: true, value: NH.today() }, { name: 'depositRefunded', label: 'Deposit refunded (KES)', type: 'number', value: 0 }, { name: 'note', label: 'Notes (damages, meter readings...)', type: 'textarea' }]);
    modal('Move out ' + t.name, h('div', { class: 'stack' }, h('div', { class: 'note warn' }, 'The unit becomes vacant. Any unpaid bills stay on record. Consider doing a move-out inspection first.'), f.el), { actions: (close) => [h('button', { class: 'btn line', onclick: close }, 'Cancel'), h('button', { class: 'btn red', onclick: (e) => busy(e.currentTarget, async () => { const r = await NH.post(`/api/leases/${lease.id}/terminate`, f.values()); close(); toast(r.outstanding > 0 ? `Moved out. Unpaid balance: ${money(r.outstanding)}` : 'Moved out', r.outstanding > 0 ? 'bad' : 'ok'); NH.refresh(); }) }, 'Confirm move-out')] });
  }

  /* ---------- leases ---------- */
  route('/leases', async () => {
    NH.title('Leases');
    const d = await NH.get('/api/leases');
    const active = d.leases.filter((l) => l.status === 'active');
    const upload = (l) => { const inp = NH.pickFiles('application/pdf,image/jpeg,image/png,image/webp'); inp.multiple = false; inp.onchange = () => busy(null, async () => { await NH.uploadFiles('lease', l.id, inp.files); toast('Lease agreement stored securely (encrypted)', 'ok'); NH.refresh(); }); inp.click(); };
    return h('div', { class: 'stack' }, pageHead('Leases'), h('div', { class: 'note' }, 'Lease agreements (PDF or photo) are encrypted on the server. Every time one is opened it is written to the audit trail.'),
      card(table([{ h: 'Tenant', c: (l) => h('div', null, h('b', null, l.tenantName), h('div', { class: 'small muted' }, l.unitName + ' - ' + l.propertyName)) }, { h: 'Rent', cls: 'num', c: (l) => money(l.rent) }, { h: 'Period', c: (l) => `${fdate(l.startDate)} → ${l.endDate ? fdate(l.endDate) : 'ongoing'}` }, { h: 'Status', c: (l) => NH.stateBadge(l.status) },
        { h: 'Agreement', c: (l) => (l.document ? h('a', { class: 'btn sm ghost', href: '/api/files/' + l.document.id, target: '_blank', rel: 'noopener' }, icon('file'), 'Open') : NH.can('lease.document') ? h('button', { class: 'btn sm line', onclick: () => upload(l) }, icon('plus'), 'Upload') : '-') },
        { h: '', c: (l) => (l.status === 'active' && NH.can('lease.rent') ? h('button', { class: 'btn sm line', onclick: () => editLease(l) }, 'Edit') : '') }], d.leases, { empty: 'No leases yet. Add a tenant to create one.', icon: 'file' })), active.length ? h('p', { class: 'small muted' }, `${active.length} active lease(s).`) : null);
  }, { title: 'Leases' });
  function editLease(l) {
    const f = NH.form([{ name: 'rent', label: 'Monthly rent (KES)', type: 'number', value: l.rent, required: true }, { name: 'deposit', label: 'Deposit (KES)', type: 'number', value: l.deposit }, { name: 'dueDay', label: 'Due day', type: 'number', value: l.dueDay }, { name: 'endDate', label: 'Lease ends', type: 'date', value: l.endDate }, { name: 'notes', label: 'Notes', type: 'textarea', value: l.notes }]);
    modal('Edit lease - ' + l.tenantName, h('div', { class: 'stack' }, h('div', { class: 'note warn' }, 'A new rent applies from the next invoice. The change is recorded in the audit trail and the tenant is notified.'), f.el), { actions: (close) => [h('button', { class: 'btn line', onclick: close }, 'Cancel'), h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, async () => { const v = f.values(); v.version = l.version; await NH.put('/api/leases/' + l.id, v); close(); toast('Saved', 'ok'); NH.refresh(); }) }, 'Save')] });
  }

  /* shared with payments screen */
  NH.recordPayment = recordPayment; NH.addCharge = addCharge; NH.paymentDetail = paymentDetail;
  async function recordPayment(tenant) {
    let tenants = tenant ? [tenant] : (await NH.get('/api/tenants')).tenants;
    const tSel = h('select', null, tenants.map((t) => h('option', { value: t.id, selected: tenant && t.id === tenant.id }, `${t.name} - ${t.unitName || ''}`)));
    const f = NH.form([{ name: 'amount', label: 'Amount received (KES)', type: 'number', required: true }, { name: 'method', label: 'Method', type: 'select', options: [['cash', 'Cash'], ['mpesa', 'M-Pesa (paid to your till/paybill)'], ['bank', 'Bank transfer'], ['cheque', 'Cheque']], value: 'cash' }, { name: 'providerRef', label: 'Transaction code / reference', hint: 'Required for M-Pesa, bank and cheque. e.g. SJK1ABC234' }, { name: 'paidDate', label: 'Date received', type: 'date', value: NH.today() }, { name: 'note', label: 'Note (optional)', full: true }]);
    modal('Record a payment', h('div', { class: 'stack' }, h('div', { class: 'f' }, h('label', null, 'Tenant'), tSel), f.el, h('p', { class: 'small muted' }, 'Use this for money you received outside the app. It is applied to the oldest unpaid bills first and a receipt is created.')), { actions: (close) => [h('button', { class: 'btn line', onclick: close }, 'Cancel'), h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, async () => { const v = f.values(); v.tenantId = tSel.value; const r = await NH.post('/api/payments/record', v); close(); toast('Payment recorded - receipt ' + r.payment.receiptNo, 'ok'); NH.refresh(); }) }, 'Save payment')] });
  }
  function addCharge(t) {
    const f = NH.form([{ name: 'desc', label: 'What is it for?', required: true, placeholder: 'Water bill, garbage, repair damage...', full: true }, { name: 'amount', label: 'Amount (KES)', type: 'number', required: true }, { name: 'dueDate', label: 'Due date', type: 'date', required: true, value: NH.today() }]);
    modal('Add charge for ' + t.name, f.el, { actions: (close) => [h('button', { class: 'btn line', onclick: close }, 'Cancel'), h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, async () => { const v = f.values(); v.tenantId = t.id; await NH.post('/api/invoices/charge', v); close(); toast('Charge added and tenant notified', 'ok'); NH.refresh(); }) }, 'Add charge')] });
  }
  function paymentDetail(x) {
    const rows = [['Amount', money(x.amount)], ['Method', NH.METHOD[x.method] + (x.simulated ? ' (PRACTICE)' : '')], ['Status', NH.stateBadge(x.status)], ['Reference', x.providerRef || x.bankRef || '-'], ['Date', fdt(x.paidAt || x.createdAt)], ['Receipt', x.receiptNo || '-'], x.note ? ['Note', x.note] : null, x.failReason ? ['Reason', x.failReason] : null, x.reverseReason ? ['Reversed because', x.reverseReason] : null].filter(Boolean);
    modal('Payment', h('div', { class: 'stack' }, rows.map(([a, b]) => h('div', { class: 'row between', style: { borderBottom: '1px solid #eef2f9', padding: '.3rem 0' } }, h('span', { class: 'muted' }, a), h('b', null, b)))), { actions: (close) => [
      x.status === 'completed' ? h('button', { class: 'btn ghost', onclick: () => { close(); busy(null, () => NH.receiptModal(x.id)); } }, 'Receipt') : null,
      x.status === 'awaiting_confirmation' && NH.can('rent.collect') ? h('button', { class: 'btn red', onclick: (e) => busy(e.currentTarget, async () => { const r = prompt('Why can you not confirm it?'); if (r) { await NH.post(`/api/payments/${x.id}/reject`, { reason: r }); close(); NH.refresh(); } }) }, 'Not received') : null,
      x.status === 'awaiting_confirmation' && NH.can('rent.collect') ? h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, async () => { await NH.post(`/api/payments/${x.id}/confirm`); close(); toast('Confirmed', 'ok'); NH.refresh(); }) }, 'I received it - confirm') : null,
      x.status === 'completed' && NH.can('rent.void') ? h('button', { class: 'btn line red', onclick: (e) => busy(e.currentTarget, async () => { const r = prompt('Reason for reversing this payment? (recorded in the audit trail)'); if (r) { await NH.post(`/api/payments/${x.id}/reverse`, { reason: r }); close(); toast('Payment reversed', 'ok'); NH.refresh(); } }) }, 'Reverse payment') : null, h('button', { class: 'btn line', onclick: close }, 'Close')] });
  }
})();
