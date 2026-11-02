'use strict';
/* Views shared by several roles: dashboards, account, roles page, public house search, chat, receipts. */
(function () {
  const { h, icon, api, money, fdate, fdt, ago, route } = NH;
  const { card, stat, empty, pageHead, table, toast, modal, busy } = NH.ui;
  const $setTitle = (t) => { const e = document.getElementById('pagetitle'); if (e) e.textContent = t; };
  NH.title = $setTitle;
  NH.home = () => (NH.user && NH.user.role === 'national_admin' ? '/admin' : '/');

  /* ---------- helpers reused everywhere ---------- */
  NH.shareCredentials = function (title, who, login, password, note) {
    const box = h('div', { class: 'stack' },
      h('div', { class: 'note ok' }, `Account created for ${who}. Give them these sign-in details. They must choose their own password the first time they sign in.`),
      h('div', { class: 'card', style: { fontFamily: 'ui-monospace,monospace' } }, h('div', null, 'Sign in with: ', h('b', null, login)), h('div', null, 'Temporary password: ', h('b', { style: { fontSize: '1.2rem' } }, password))),
      note ? h('p', { class: 'small muted' }, note) : null, h('p', { class: 'small muted' }, 'This password is shown only once. It is stored encrypted and cannot be viewed again.'));
    modal(title || 'Account ready', box, { actions: (close) => [h('button', { class: 'btn ghost', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(`Jasmyle Properties sign-in: ${login}\nTemporary password: ${password}\nOpen: ${location.origin}`); toast('Copied', 'ok'); } }, 'Copy details'), h('button', { class: 'btn', onclick: close }, 'Done')] });
  };
  NH.receiptModal = async function (paymentId) {
    const { receipt: r } = await NH.get('/api/payments/' + paymentId + '/receipt');
    const row = (a, b) => h('div', { class: 'row between', style: { padding: '.25rem 0', borderBottom: '1px solid #eef2f9' } }, h('span', { class: 'muted' }, a), h('b', null, b));
    modal('Receipt ' + r.receiptNo, h('div', { class: 'receipt stack' },
      h('div', { class: 'row between' }, h('div', null, h('h2', null, r.landlord || 'Rent receipt'), h('div', { class: 'small muted' }, r.property + (r.address ? ' - ' + r.address : ''))), r.simulated ? h('span', { class: 'watermark' }, 'PRACTICE') : h('span', { class: 'badge ok' }, 'PAID')),
      h('div', { class: 'big' }, money(r.amount)), row('Receipt no.', r.receiptNo), row('Date', fdt(r.paidAt)), row('Received from', r.tenant), row('Unit', r.unit), row('Method', NH.METHOD[r.method] || r.method), r.reference ? row('Reference', r.reference) : null,
      r.allocations.length ? h('div', null, h('div', { class: 'small muted', style: { marginTop: '.4rem' } }, 'Applied to'), r.allocations.map((a) => row(a.desc || 'Invoice', money(a.amount)))) : null, r.credit ? row('Advance credit', money(r.credit)) : null, row('Balance after this payment', money(r.balanceNow)),
      h('p', { class: 'small muted center' }, 'Thank you for paying your rent.')), { actions: (close) => [h('button', { class: 'btn ghost', onclick: () => window.print() }, icon('print'), 'Print / Save as PDF'), h('button', { class: 'btn', onclick: close }, 'Close')] });
  };
  NH.pickFiles = function (accept) { return h('input', { type: 'file', multiple: true, accept: accept || 'image/*,video/*', class: 'file' }); };

  /* ---------- dashboards ---------- */
  route('/', async () => {
    const d = await NH.get('/api/dashboard'); const u = NH.user;
    if (d.kind === 'national_admin') { NH.go('/admin'); return h('div'); }
    if (d.kind === 'tenant') return tenantHome(d);
    if (d.kind === 'contractor') return contractorHome(d);
    $setTitle('Dashboard');
    const node = h('div', { class: 'stack' });
    node.append(h('div', { class: 'head' }, h('div', null, h('h1', null, 'Hello, ' + u.name.split(' ')[0]), h('p', { class: 'muted' }, (u.orgName || '') + ' - ' + NH.ROLE[u.role])), h('div', { class: 'row' },
      NH.can('tenant.write') && NH.can('lease.write') ? h('a', { class: 'btn', href: '#/tenants?new=1' }, icon('plus'), 'Add tenant') : null, NH.can('rent.collect') ? h('a', { class: 'btn ghost', href: '#/payments?record=1' }, icon('cash'), 'Record payment') : null,
      NH.can('maintenance.report') ? h('a', { class: 'btn ghost', href: '#/maintenance?new=1' }, icon('wrench'), 'Report repair') : null)));
    if (d.awaitingConfirmation) node.append(h('div', { class: 'note warn' }, `${d.awaitingConfirmation} bank payment(s) are waiting for you to confirm. `, h('a', { href: '#/payments?tab=confirm' }, 'Review now')));
    if (d.maintenance.escalated && NH.can('maintenance.approve') && u.role === 'landlord') node.append(h('div', { class: 'note warn' }, `${d.maintenance.escalated} repair(s) need your approval because they are above the manager's limit. `, h('a', { href: '#/maintenance' }, 'Open')));
    if (d.finance) {
      const f = d.finance;
      node.append(h('div', { class: 'grid g4' }, stat('Collected in ' + NH.monthName(f.month).split(' ')[0], money(f.income), f.expected ? `${f.rate}% of ${money(f.expected)} billed` : 'No rent billed yet', 'blue'), stat('Overdue rent', money(f.arrears), f.arrearsCount + ' tenant(s) behind', f.arrears ? 'red' : ''), stat('Expenses', money(f.expenses), 'Net: ' + money(f.net)), stat('Occupancy', d.units ? Math.round((d.occupied / d.units) * 100) + '%' : '-', `${d.occupied} of ${d.units} units - ${d.vacant} vacant`)));
      node.append(h('div', { class: 'grid g2' }, card(h('div', { class: 'head' }, h('h2', null, 'Income vs expenses'), h('span', { class: 'small muted' }, 'last 6 months')), NH.barChart(f.trend)),
        card(h('div', { class: 'head' }, h('h2', null, 'Who owes rent'), h('a', { class: 'small', href: '#/payments?tab=arrears' }, 'See all')), d.topArrears.length ? table([{ h: 'Tenant', c: (r) => h('div', null, h('b', null, r.tenantName), h('div', { class: 'small muted' }, r.unitName)) }, { h: 'Late', c: (r) => r.daysOverdue + ' d' }, { h: 'Owes', cls: 'num', c: (r) => h('b', { class: 'red' }, money(r.balance)) }], d.topArrears, { onRow: (r) => NH.go('/tenants/' + r.tenantId) }) : empty('Nobody is behind on rent.', 'check'))));
    }
    node.append(h('div', { class: 'grid g2' }, card(h('div', { class: 'head' }, h('h2', null, 'Repairs needing attention'), h('a', { class: 'small', href: '#/maintenance' }, 'Open')), h('div', { class: 'row', style: { marginBottom: '.6rem' } }, NH.badge(d.maintenance.waiting + ' new', d.maintenance.waiting ? 'warn' : 'gray'), NH.badge(d.maintenance.urgent + ' urgent', d.maintenance.urgent ? 'bad' : 'gray'), NH.badge(d.maintenance.open + ' open', '')),
      d.recent.length ? table([{ h: 'Problem', c: (m) => h('div', null, h('b', null, m.title), h('div', { class: 'small muted' }, m.unitName + ' - ' + m.propertyName)) }, { h: 'Status', c: (m) => NH.stateBadge(m.status) }], d.recent, { onRow: (m) => NH.go('/maintenance/' + m.id) }) : empty('No open repairs', 'wrench')),
      d.recentPayments ? card(h('div', { class: 'head' }, h('h2', null, 'Latest payments'), h('a', { class: 'small', href: '#/payments' }, 'See all')), d.recentPayments.length ? table([{ h: 'Tenant', c: (p) => h('div', null, h('b', null, p.tenantName), h('div', { class: 'small muted' }, p.unitName + ' - ' + (NH.METHOD[p.method] || p.method))) }, { h: 'When', c: (p) => ago(p.paidAt) }, { h: 'Amount', cls: 'num', c: (p) => h('b', { class: 'green' }, money(p.amount)) }], d.recentPayments) : empty('No payments yet', 'card')) : card(h('h2', null, 'Your properties'), h('p', { class: 'muted' }, `${d.properties} property(ies), ${d.units} units`), h('a', { class: 'btn', href: '#/properties' }, 'View properties'))));
    if (!d.properties) node.append(card(h('h2', null, 'Get started'), h('p', null, u.role === 'landlord' ? 'Add your first property, then its units, then move tenants in.' : 'No property has been assigned to you yet. Ask the landlord.'), u.role === 'landlord' ? h('a', { class: 'btn', href: '#/properties?new=1' }, 'Add property') : null));
    return node;
  }, { title: 'Dashboard' });

  function tenantHome(d) {
    $setTitle('My home');
    const node = h('div', { class: 'stack' });
    node.append(h('div', { class: 'grid g2' },
      h('div', { class: 'card hero ' + (d.overdueCount ? 'red-hero' : '') }, h('div', { class: 'lbl small' }, d.unitName ? `${d.unitName}, ${d.propertyName}` : 'Your account'), h('h2', { style: { marginTop: '.4rem' } }, d.balance > 0 ? 'You owe' : 'You are all paid up'), h('div', { class: 'val', style: { fontSize: '2.3rem', fontWeight: 800 } }, money(d.balance)),
        d.nextDue ? h('p', null, d.nextDue.state === 'overdue' ? `${d.nextDue.desc} was due ${fdate(d.nextDue.dueDate)} (${d.nextDue.daysOverdue} days ago)` : `Next: ${d.nextDue.desc} due ${fdate(d.nextDue.dueDate)}`) : h('p', null, 'Nothing due right now.'),
        d.balance > 0 ? h('a', { class: 'btn lg', style: { background: '#fff', color: d.overdueCount ? 'var(--r7)' : 'var(--b8)', marginTop: '.6rem' }, href: '#/pay' }, icon('card'), 'Pay rent now') : null),
      card(h('h2', null, 'Quick actions'), h('div', { class: 'grid g2' }, h('a', { class: 'btn ghost', href: '#/maintenance?new=1' }, icon('wrench'), 'Report a problem'), h('a', { class: 'btn ghost', href: '#/chat' }, icon('chat'), 'Message landlord' + (d.unreadMessages ? ` (${d.unreadMessages})` : '')), h('a', { class: 'btn ghost', href: '#/payments' }, icon('file'), 'My receipts'), h('a', { class: 'btn ghost', href: '#/lease' }, icon('clip'), 'My lease')),
        d.openRequests ? h('p', { class: 'small muted', style: { marginTop: '.7rem' } }, `You have ${d.openRequests} open repair request(s).`) : null)));
    node.append(h('div', { class: 'grid g2' }, card(h('h2', null, 'Bills'), d.openInvoices.length ? table([{ h: 'Item', c: (i) => i.desc }, { h: 'Due', c: (i) => fdate(i.dueDate) }, { h: 'Status', c: (i) => NH.stateBadge(i.state) }, { h: 'Balance', cls: 'num', c: (i) => h('b', null, money(i.balance)) }], d.openInvoices) : empty('No unpaid bills', 'check')),
      card(h('div', { class: 'head' }, h('h2', null, 'Recent payments'), h('a', { class: 'small', href: '#/payments' }, 'All')), d.recentPayments.length ? table([{ h: 'Date', c: (p) => fdate(p.paidAt) }, { h: 'Method', c: (p) => NH.METHOD[p.method] }, { h: 'Amount', cls: 'num', c: (p) => money(p.amount) }, { h: '', c: (p) => h('button', { class: 'btn sm ghost', onclick: () => busy(null, () => NH.receiptModal(p.id)) }, 'Receipt') }], d.recentPayments) : empty('No payments yet', 'card'))));
    return node;
  }
  function contractorHome(d) {
    $setTitle('My jobs');
    return h('div', { class: 'stack' }, pageHead('My jobs'), h('div', { class: 'grid g3' }, stat('Assigned to start', d.assigned, '', d.assigned ? 'red' : ''), stat('In progress', d.inProgress, '', 'blue'), stat('Completed', d.completed)),
      card(h('h2', null, 'Current jobs'), d.upcoming.length ? table([{ h: 'Job', c: (m) => h('div', null, h('b', null, m.title), h('div', { class: 'small muted' }, m.propertyName + ' - ' + m.unitName)) }, { h: 'Priority', c: (m) => NH.stateBadge(m.priority) }, { h: 'Status', c: (m) => NH.stateBadge(m.status) }, { h: 'Scheduled', c: (m) => m.scheduledDate ? fdate(m.scheduledDate) : '-' }], d.upcoming, { onRow: (m) => NH.go('/maintenance/' + m.id) }) : empty('No jobs assigned right now', 'wrench')));
  }

  /* ---------- account ---------- */
  route('/account', async () => {
    $setTitle('My account'); const u = NH.user;
    const node = h('div', { class: 'stack' }, pageHead('My account'));
    const pw = [h('input', { type: 'password', autocomplete: 'current-password' }), h('input', { type: 'password', autocomplete: 'new-password' })];
    node.append(card(h('h2', null, 'Profile'), h('div', { class: 'grid g2' }, h('div', null, h('div', { class: 'muted small' }, 'Name'), h('b', null, u.name)), h('div', null, h('div', { class: 'muted small' }, 'Role'), h('b', null, NH.ROLE[u.role])), h('div', null, h('div', { class: 'muted small' }, 'Email'), h('b', null, u.email || '-')), h('div', null, h('div', { class: 'muted small' }, 'Phone'), h('b', null, NH.phone(u.phone) || '-')))));
    node.append(card(h('h2', null, 'Change password'), h('div', { class: 'form-grid' }, h('div', { class: 'f' }, h('label', null, 'Current password'), pw[0]), h('div', { class: 'f' }, h('label', null, 'New password'), pw[1], h('div', { class: 'hint' }, 'At least 10 characters, 3 of 4 kinds (a-z, A-Z, 0-9, symbols).'))),
      h('button', { class: 'btn', style: { marginTop: '.8rem' }, onclick: (e) => busy(e.currentTarget, async () => { await NH.post('/api/auth/change-password', { current: pw[0].value, next: pw[1].value }); toast('Password changed. Other devices were signed out.', 'ok'); pw[0].value = pw[1].value = ''; }) }, 'Update password')));
    const mfa = card(h('h2', null, 'Two-factor authentication'));
    const paintMfa = () => { NH.clear(mfa).append(h('h2', null, 'Two-factor authentication'));
      if (NH.user.mfaEnabled) { const p = h('input', { type: 'password', placeholder: 'Your password' }); mfa.append(h('div', { class: 'note ok' }, 'ON - a code from your phone is needed at every sign-in.'), NH.user.role === 'national_admin' ? h('p', { class: 'small muted' }, 'Required for National Administrators.') : h('div', { class: 'row', style: { marginTop: '.6rem' } }, p, h('button', { class: 'btn red', onclick: (e) => busy(e.currentTarget, async () => { await NH.post('/api/auth/2fa/disable', { password: p.value }); NH.user.mfaEnabled = false; toast('Two-factor turned off'); paintMfa(); }) }, 'Turn off'))); }
      else mfa.append(h('p', { class: 'muted' }, NH.user.role === 'landlord' ? 'Strongly recommended: protects your rent money even if your password leaks.' : 'Adds a second lock to your account.'), h('button', { class: 'btn', onclick: () => { const m = modal('Turn on two-factor', NH.mfaPanel(() => { m.close(); NH.user.mfaEnabled = true; paintMfa(); })); } }, icon('shield'), 'Set up two-factor')); };
    paintMfa(); node.append(mfa);
    for (const fn of NH.accountExtras || []) node.append(fn());
    const ss = card(h('h2', null, 'Where you are signed in')); node.append(ss);
    NH.get('/api/auth/sessions').then((d) => ss.append(table([{ h: 'Device', c: (s) => h('div', null, (s.ua || '').slice(0, 60) || 'Unknown', s.current ? h('span', { class: 'badge ok', style: { marginLeft: '.4rem' } }, 'This device') : null) }, { h: 'Location (IP)', c: (s) => s.ip }, { h: 'Last active', c: (s) => ago(s.lastSeen) }], d.sessions), d.sessions.length > 1 ? h('button', { class: 'btn line', style: { marginTop: '.7rem' }, onclick: (e) => busy(e.currentTarget, async () => { await NH.post('/api/auth/sessions/revoke-others'); toast('Signed out of other devices', 'ok'); NH.refresh(); }) }, 'Sign out of all other devices') : null));
    return node;
  }, { title: 'Account' });

  /* ---------- roles & permissions page ---------- */
  route('/roles', async () => {
    $setTitle('Roles & permissions');
    const d = await NH.get('/api/roles');
    return h('div', { class: 'stack' }, pageHead('Roles & permissions'), h('div', { class: 'note' }, 'Every action is checked on the server against this list - hiding a button is never the only protection. Anything not listed is denied. Everyone can see these rules so there are no surprises.'),
      h('div', { class: 'grid auto', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))' } }, d.roles.map((r) => h('div', { class: 'card', style: r.key === d.you ? { outline: '3px solid var(--r6)' } : {} },
        h('div', { class: 'head' }, h('h2', null, r.label), r.key === d.you ? NH.badge('You', 'bad') : null), h('p', { class: 'muted small' }, r.blurb), h('p', { class: 'small' }, h('b', null, 'Can see: '), r.scope),
        h('h3', { style: { marginTop: '.7rem' } }, 'Can'), h('ul', { class: 'clean perm-list small' }, r.can.map((x) => h('li', { class: 'ok-i' }, x))), h('h3', { style: { marginTop: '.7rem' } }, 'Cannot'), h('ul', { class: 'clean perm-list small' }, r.cannot.map((x) => h('li', { class: 'no-i' }, x)))))));
  }, { title: 'Roles' });

  /* ---------- public house search ---------- */
  function listingCard(l, onOpen) {
    return h('div', { class: 'card stack' }, h('div', { class: 'head' }, h('h3', null, `${l.type}${l.bedrooms ? ' - ' + l.bedrooms + ' bed' : ''}`), NH.badge('Verified', 'ok')),
      h('div', { class: 'blue bold', style: { fontSize: '1.4rem' } }, money(l.rent), h('span', { class: 'small muted' }, ' / month')), h('div', { class: 'muted' }, `${l.property}, ${l.town}, ${l.county}`),
      h('div', null, (l.amenities || []).slice(0, 5).map((a) => h('span', { class: 'chip' }, a))), h('button', { class: 'btn', onclick: () => onOpen(l) }, 'View & enquire'));
  }
  route('/find', async (p, q) => {
    const county = h('select', null, h('option', { value: '' }, 'All counties')); const search = h('input', { type: 'search', placeholder: 'Area, estate or type e.g. Kilimani' }); const max = h('input', { type: 'number', placeholder: 'Max rent (KES)' }); const beds = h('select', null, [['', 'Any bedrooms'], ['1', '1+'], ['2', '2+'], ['3', '3+']].map(([v, l]) => h('option', { value: v }, l)));
    const out = h('div', { class: 'grid auto' }); const count = h('p', { class: 'muted' });
    async function load() {
      const qs = new URLSearchParams(); if (county.value) qs.set('county', county.value); if (search.value) qs.set('q', search.value); if (max.value) qs.set('maxRent', max.value); if (beds.value) qs.set('bedrooms', beds.value);
      try { const d = await api('GET', '/api/public/listings?' + qs, undefined, { quiet: true }); if (county.options.length === 1) for (const c of d.counties) county.append(h('option', { value: c }, c));
        count.textContent = `${d.total} verified home(s) available`; NH.clear(out).append(...(d.listings.length ? d.listings.map((l) => listingCard(l, openListing)) : [empty('No homes match. Try different filters.', 'search')])); } catch (e) { toast(e.message, 'bad'); }
    }
    function openListing(l) {
      const name = h('input', { type: 'text', placeholder: 'Your name' }); const ph = h('input', { type: 'tel', placeholder: '0712 345 678' }); const msg = h('textarea', { placeholder: 'Message (optional)' }); const hp = h('input', { type: 'text', style: { display: 'none' }, tabindex: '-1', autocomplete: 'off' });
      modal(`${l.type} in ${l.town}`, h('div', { class: 'stack' }, h('div', { class: 'blue bold', style: { fontSize: '1.5rem' } }, money(l.rent) + ' / month'), h('p', null, `Deposit: ${money(l.deposit)} - ${l.property}, ${l.town}, ${l.county}`), l.description ? h('p', null, l.description) : null, l.propertyDescription ? h('p', { class: 'muted' }, l.propertyDescription) : null, h('div', null, (l.amenities || []).map((a) => h('span', { class: 'chip' }, a))), l.rules ? h('p', { class: 'small muted' }, 'House rules: ' + l.rules) : null,
        h('div', { class: 'note' }, 'This property has been verified by National Administration. The exact address is shared when you view the house.'), h('h3', null, 'Interested? Leave your number'), h('div', { class: 'form-grid' }, h('div', { class: 'f' }, name), h('div', { class: 'f' }, ph), h('div', { class: 'f full' }, msg)), hp),
        { actions: (close) => [h('button', { class: 'btn line', onclick: close }, 'Close'), h('button', { class: 'btn red', onclick: (e) => busy(e.currentTarget, async () => { const r = await api('POST', '/api/public/inquiry', { unitId: l.id, name: name.value, phone: ph.value, message: msg.value, website: hp.value }, { quiet: true }); toast(r.message || 'Sent', 'ok'); close(); }) }, 'Request a call')] });
    }
    [county, beds].forEach((e) => e.addEventListener('change', load)); max.addEventListener('change', load); let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 350); });
    load();
    return h('div', { class: 'stack' }, h('div', { class: 'card hero' }, h('h1', { style: { color: '#fff' } }, 'Find a verified home'), h('p', null, 'Every listing here belongs to a landlord checked by National Administration.')),
      h('div', { class: 'card' }, h('div', { class: 'form-grid' }, h('div', { class: 'f' }, h('label', null, 'Search'), search), h('div', { class: 'f' }, h('label', null, 'County'), county), h('div', { class: 'f' }, h('label', null, 'Max rent'), max), h('div', { class: 'f' }, h('label', null, 'Bedrooms'), beds))), count, out);
  }, { auth: false, title: 'Find a home' });

  /* ---------- chat (tenant <-> landlord/manager/caretaker) ---------- */
  route('/chat/:tid', (p) => chatView(p.tid), { title: 'Messages' });
  route('/chat', () => chatView(null), { title: 'Messages' });
  async function chatView(openId) {
    $setTitle('Messages');
    const isTenant = NH.user.role === 'tenant'; const wrap = h('div', { class: 'split' }); const list = h('div', { class: 'card', style: { padding: 0, maxHeight: '70vh', overflow: 'auto' } }); const conv = h('div', { class: 'card stack' });
    let cur = isTenant ? NH.user.id : openId; let timer;
    async function loadThreads() { const d = await NH.get('/api/messages/threads'); NH.clear(list); if (!d.threads.length) list.append(empty('No tenants yet', 'users')); for (const t of d.threads) list.append(h('div', { class: 'thread' + (t.tenantId === cur ? ' on' : ''), onclick: () => { cur = t.tenantId; loadThreads(); loadConv(); } }, h('div', { style: { minWidth: 0 } }, h('b', null, t.name), h('div', { class: 'small muted', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, (t.unitName ? t.unitName + ' - ' : '') + (t.last || 'No messages'))), t.unread ? h('span', { class: 'badge bad' }, t.unread) : null)); return d.threads; }
    async function loadConv(keep) {
      if (!cur) { NH.clear(conv).append(empty('Choose a conversation', 'chat')); return; }
      const d = await NH.get('/api/messages/thread/' + cur); const box = h('div', { class: 'chat' }, d.messages.length ? d.messages.map((m) => h('div', { class: 'bub' + (m.mine ? ' me' : '') }, h('div', { class: 'who' }, (m.mine ? 'You' : m.fromName) + ' - ' + fdt(m.at)), m.text)) : empty('Say hello!', 'chat'));
      const inp = h('input', { type: 'text', placeholder: 'Type a message...', maxlength: 1000 }); const send = async () => { if (!inp.value.trim()) return; const t = inp.value; inp.value = ''; try { await NH.post('/api/messages', { tenantId: cur, text: t }); loadConv(); } catch (e) { inp.value = t; toast(e.message, 'bad'); } };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });
      NH.clear(conv).append(h('h2', null, isTenant ? 'Your landlord / property manager' : d.tenant.name), box, h('div', { class: 'row' }, h('div', { class: 'grow' }, inp), h('button', { class: 'btn', onclick: send }, 'Send')));
      box.scrollTop = box.scrollHeight;
    }
    wrap.append(...(isTenant ? [h('div', { style: { gridColumn: '1/-1' } }, conv)] : [list, conv])); if (isTenant) wrap.style.gridTemplateColumns = '1fr';
    const th = await loadThreads(); if (!cur && th.length && window.innerWidth > 980) cur = th[0].tenantId; await loadConv();
    clearInterval(NH._chatTimer); NH._chatTimer = setInterval(() => { if (!document.body.contains(wrap)) return clearInterval(NH._chatTimer); if (document.activeElement && document.activeElement.tagName === 'INPUT' && document.activeElement.value) { loadThreads(); return; } loadThreads(); loadConv(); }, 10000);
    return h('div', { class: 'stack' }, pageHead('Messages'), wrap);
  }
})();
