'use strict';
/* National Administration screens: account-level and aggregate information only. */
(function () {
  const { h, icon, money, fdate, fdt, ago, route } = NH;
  const { card, stat, empty, pageHead, table, toast, modal, busy, confirmBox } = NH.ui;

  route('/admin', async () => {
    NH.title('National overview');
    const s = await NH.get('/api/admin/stats');
    const node = h('div', { class: 'stack' }, pageHead('National overview'),
      h('div', { class: 'grid g4' }, stat('Landlords', s.landlords.total, `${s.landlords.active} active - ${s.landlords.suspended} suspended`, 'blue'), stat('Waiting for approval', s.landlords.pending, 'new landlord sign-ups', s.landlords.pending ? 'red' : ''), stat('Properties', s.properties.total, `${s.properties.verified} verified - ${s.properties.unverified} to verify`), stat('Occupancy', s.occupancyRate + '%', `${s.units.occupied} of ${s.units.total} units - ${s.tenants} tenants`)),
      h('div', { class: 'note' }, 'As National Administrator you see accounts and totals only. Tenants\' rent, leases, messages and repairs are private to each landlord organisation and are not available to you.'));
    if (s.pendingLandlords.length) node.append(card(h('h2', null, 'Landlords waiting for approval'), table([{ h: 'Name', c: (l) => h('div', null, h('b', null, l.name), h('div', { class: 'small muted' }, l.company)) }, { h: 'Contact', c: (l) => h('div', null, l.email, h('div', { class: 'small muted' }, NH.phone(l.phone))) }, { h: 'Where', c: (l) => [l.town, l.county].filter(Boolean).join(', ') }, { h: 'Registered', c: (l) => ago(l.createdAt) },
      { h: '', c: (l) => h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: (e) => busy(e.currentTarget, async () => { await NH.post(`/api/admin/landlords/${l.id}/status`, { status: 'active' }); toast('Approved', 'ok'); NH.refresh(); }) }, icon('check'), 'Approve'), h('button', { class: 'btn sm red', onclick: (e) => busy(e.currentTarget, async () => { if (await confirmBox('Reject registration?', 'The account will be suspended.', 'Reject', true)) { await NH.post(`/api/admin/landlords/${l.id}/status`, { status: 'suspended', reason: 'Registration rejected' }); NH.refresh(); } }) }, 'Reject')) }], s.pendingLandlords)));
    node.append(card(h('h2', null, 'Housing by county'), table([{ h: 'County', c: (c) => h('b', null, c.county) }, { h: 'Properties', cls: 'num', c: (c) => c.properties }, { h: 'Units', cls: 'num', c: (c) => c.units }, { h: 'Occupied', cls: 'num', c: (c) => c.occupied }, { h: 'Occupancy', c: (c) => h('div', { style: { minWidth: '120px' } }, h('div', { class: 'bar' }, h('i', { style: { width: (c.units ? Math.round((c.occupied / c.units) * 100) : 0) + '%' } }))) }], s.byCounty, { empty: 'No properties registered yet', icon: 'building' })));
    return node;
  }, { title: 'National overview' });

  route('/admin/landlords', async () => {
    NH.title('Landlords');
    const d = await NH.get('/api/admin/landlords');
    const addBtn = h('button', { class: 'btn', onclick: () => {
      const f = NH.form([{ name: 'name', label: 'Full name', required: true }, { name: 'company', label: 'Company (optional)' }, { name: 'email', label: 'Email', type: 'email', required: true }, { name: 'phone', label: 'Phone', type: 'tel', required: true }, { name: 'county', label: 'County' }, { name: 'town', label: 'Town' }]);
      modal('Create landlord account', f.el, { actions: (close) => [h('button', { class: 'btn line', onclick: close }, 'Cancel'), h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, async () => { const r = await NH.post('/api/admin/landlords', f.values()); close(); NH.shareCredentials('Landlord created', r.landlord.name, r.landlord.email, r.tempPassword); NH.refresh(); }) }, 'Create')] });
    } }, icon('plus'), 'Add landlord');
    return h('div', { class: 'stack' }, pageHead('Landlords', addBtn), card(table([
      { h: 'Landlord', c: (l) => h('div', null, h('b', null, l.name), h('div', { class: 'small muted' }, l.company || l.email)) }, { h: 'Status', c: (l) => NH.stateBadge(l.status === 'pending' ? 'submitted' : l.status) }, { h: 'Properties', cls: 'num', c: (l) => `${l.properties} (${l.verifiedProperties} verified)` }, { h: 'Units', cls: 'num', c: (l) => `${l.occupied}/${l.units}` },
      { h: '2FA', c: (l) => (l.mfaEnabled ? NH.badge('On', 'ok') : NH.badge('Off', 'gray')) }, { h: 'Last sign-in', c: (l) => (l.lastLoginAt ? ago(l.lastLoginAt) : 'never') },
      { h: '', c: (l) => h('div', { class: 'row' }, l.status !== 'active' ? h('button', { class: 'btn sm', onclick: (e) => busy(e.currentTarget, async () => { await NH.post(`/api/admin/landlords/${l.id}/status`, { status: 'active' }); NH.refresh(); }) }, 'Activate') : h('button', { class: 'btn sm red', onclick: (e) => busy(e.currentTarget, async () => { if (await confirmBox('Suspend this landlord?', 'Everyone in their organisation (managers, caretakers, tenants) is signed out and cannot sign in until you re-activate.', 'Suspend', true)) { await NH.post(`/api/admin/landlords/${l.id}/status`, { status: 'suspended' }); NH.refresh(); } }) }, 'Suspend'),
        h('button', { class: 'btn sm ghost', onclick: (e) => busy(e.currentTarget, async () => { const reset2 = await confirmBox('Reset password', `Create a new temporary password for ${l.name}? Only do this after confirming their identity.`, 'Reset'); if (!reset2) return; const mfa = await confirmBox('Also reset two-factor?', 'Choose Yes if they lost their phone.', 'Yes, reset 2FA'); const r = await NH.post(`/api/admin/landlords/${l.id}/reset-password`, { resetMfa: mfa }); NH.shareCredentials('Password reset', l.name, l.email, r.tempPassword); }) }, 'Reset password')) }], d.landlords, { empty: 'No landlords yet', icon: 'users' })));
  }, { title: 'Landlords' });

  route('/admin/properties', async () => {
    NH.title('Property verification');
    const d = await NH.get('/api/admin/properties');
    const act = async (id, path, body) => { await NH.post(`/api/admin/properties/${id}/${path}`, body); NH.refresh(); };
    return h('div', { class: 'stack' }, pageHead('Property verification'), h('div', { class: 'note' }, 'Only verified properties appear in the public "Find a home" search. Verify after you have checked ownership documents.'),
      card(table([{ h: 'Property', c: (p) => h('div', null, h('b', null, p.name), h('div', { class: 'small muted' }, [p.address, p.town, p.county].filter(Boolean).join(', '))) }, { h: 'Landlord', c: (p) => (p.landlord ? p.landlord.name : '-') }, { h: 'Units', cls: 'num', c: (p) => p.units }, { h: 'Status', c: (p) => (p.status === 'suspended' ? NH.badge('Suspended', 'bad') : p.verified ? NH.badge('Verified', 'ok') : NH.badge('Not verified', 'warn')) },
        { h: '', c: (p) => h('div', { class: 'row' }, !p.verified && p.status !== 'suspended' ? h('button', { class: 'btn sm', onclick: (e) => busy(e.currentTarget, () => act(p.id, 'verify', { verified: true })) }, icon('check'), 'Verify') : null, p.verified ? h('button', { class: 'btn sm line', onclick: (e) => busy(e.currentTarget, () => act(p.id, 'verify', { verified: false })) }, 'Remove') : null,
          p.status === 'suspended' ? h('button', { class: 'btn sm ghost', onclick: (e) => busy(e.currentTarget, () => act(p.id, 'suspend', { suspended: false })) }, 'Restore') : h('button', { class: 'btn sm red', onclick: (e) => busy(e.currentTarget, async () => { if (await confirmBox('Suspend this listing?', 'It disappears from public search and the landlord is notified.', 'Suspend', true)) await act(p.id, 'suspend', { suspended: true, note: 'Suspended by National Administration' }); }) }, 'Suspend')) }], d.properties, { empty: 'No properties yet', icon: 'building' })));
  }, { title: 'Verification' });

  route('/admin/admins', async () => {
    NH.title('Administrators');
    const d = await NH.get('/api/admin/admins');
    const add = NH.user.isSuper ? h('button', { class: 'btn', onclick: () => { const f = NH.form([{ name: 'name', label: 'Full name', required: true }, { name: 'email', label: 'Email', type: 'email', required: true }]); modal('Add National Administrator', h('div', { class: 'stack' }, h('div', { class: 'note warn' }, 'Administrators can approve landlords and verify properties. They must set up 2FA at first sign-in.'), f.el), { actions: (close) => [h('button', { class: 'btn line', onclick: close }, 'Cancel'), h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, async () => { const r = await NH.post('/api/admin/admins', f.values()); close(); NH.shareCredentials('Administrator created', r.admin.name, r.admin.email, r.tempPassword); NH.refresh(); }) }, 'Create')] }); } }, icon('plus'), 'Add administrator') : null;
    return h('div', { class: 'stack' }, pageHead('National administrators', add), card(table([{ h: 'Name', c: (a) => h('div', null, h('b', null, a.name), a.isSuper ? h('span', { class: 'badge bad', style: { marginLeft: '.4rem' } }, 'Super admin') : null, h('div', { class: 'small muted' }, a.email)) }, { h: 'Status', c: (a) => NH.stateBadge(a.status) }, { h: '2FA', c: (a) => (a.mfaEnabled ? NH.badge('On', 'ok') : NH.badge('Not set up', 'warn')) }, { h: 'Last sign-in', c: (a) => (a.lastLoginAt ? ago(a.lastLoginAt) : 'never') },
      { h: '', c: (a) => (NH.user.isSuper && !a.isSuper ? h('button', { class: 'btn sm ' + (a.status === 'active' ? 'red' : ''), onclick: (e) => busy(e.currentTarget, async () => { await NH.post(`/api/admin/admins/${a.id}/status`, { status: a.status === 'active' ? 'suspended' : 'active' }); NH.refresh(); }) }, a.status === 'active' ? 'Disable' : 'Enable') : '') }], d.admins)));
  }, { title: 'Administrators' });

  route('/admin/audit', async () => {
    NH.title('Audit trail');
    const [d, v] = await Promise.all([NH.get('/api/admin/audit'), NH.get('/api/admin/audit/verify')]);
    return h('div', { class: 'stack' }, pageHead('Platform audit trail'), h('div', { class: 'note ' + (v.ok ? 'ok' : 'bad') }, v.ok ? `Integrity check passed: ${v.checked} events are chained together and none has been altered or removed.` : `WARNING: the audit chain is broken at event ${v.brokenAt}. Someone may have tampered with the database.`),
      card(table([{ h: 'When', c: (e) => fdt(e.ts) }, { h: 'Who', c: (e) => h('div', null, e.actorName || 'System', e.role ? h('div', { class: 'small muted' }, NH.ROLE[e.role] || e.role) : null) }, { h: 'Action', c: (e) => h('code', null, e.action) }, { h: 'From', c: (e) => e.ip || '-' }, { h: 'Details', c: (e) => h('span', { class: 'small muted' }, e.detail ? JSON.stringify(e.detail).slice(0, 110) : '') }], d.events, { empty: 'No events yet', icon: 'clip' })));
  }, { title: 'Audit' });

  route('/admin/system', async () => {
    NH.title('System');
    const s = await NH.get('/api/admin/system');
    const url = h('input', { type: 'text', value: s.publicUrl, placeholder: 'https://rent.yourdomain.co.ke' });
    const up = (sec) => { const d = Math.floor(sec / 86400), hh = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60); return `${d ? d + 'd ' : ''}${hh}h ${m}m`; };
    return h('div', { class: 'stack' }, pageHead('System & backups'),
      h('div', { class: 'grid g4' }, stat('Version', s.version, 'Node ' + s.node), stat('Running for', up(s.uptimeSeconds), `${s.restarts} start(s) in total`), stat('Database size', (s.dbSize / 1048576).toFixed(1) + ' MB', 'encrypted fields + files'), stat('Time zone', s.timezone, s.adminIpAllowlist.length ? 'Admin IP lock ON' : 'Admin IP lock off')),
      card(h('h2', null, 'Public web address'), h('p', { class: 'muted' }, 'The https address people use from outside the house (set up with a Cloudflare Tunnel or similar - see the setup guide). M-Pesa and PayPal use it to confirm payments.'), h('div', { class: 'row' }, h('div', { class: 'grow' }, url), h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, async () => { await api2(url.value); }) }, 'Save'))),
      card(h('div', { class: 'head' }, h('h2', null, 'Backups'), h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, async () => { await NH.post('/api/admin/backup'); toast('Backup created', 'ok'); NH.refresh(); }) }, icon('download'), 'Back up now')), h('p', { class: 'muted small' }, 'A backup is made automatically every day (last 30 kept) in the data/backups folder. Copy that folder, plus data/secret.key, to a flash disk or cloud drive regularly - without secret.key a backup cannot be read.'), table([{ h: 'File', c: (b) => b.name }, { h: 'Size', cls: 'num', c: (b) => (b.size / 1048576).toFixed(2) + ' MB' }, { h: 'Created', c: (b) => fdt(b.at) }], s.backups, { empty: 'No backups yet' })),
      card(h('h2', null, 'Background jobs'), s.lastJobRun ? h('p', null, `Last run ${ago(s.lastJobRun.at)} (${s.lastJobRun.ms} ms): ${s.lastJobRun.invoices} invoice(s) created, ${s.lastJobRun.notices} reminder(s) sent, ${s.lastJobRun.reconciled} payment(s) reconciled.`) : h('p', { class: 'muted' }, 'Not run yet.')));
    async function api2(v) { const r = await NH.api('PUT', '/api/admin/settings', { publicUrl: v }); toast('Saved: ' + (r.publicUrl || '(cleared)'), 'ok'); }
  }, { title: 'System' });
})();
