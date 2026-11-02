'use strict';
// Dashboards, financial / vacancy / arrears / contractor reports, CSV export, public listings & enquiries.
const S = require('../store');
const { db } = S;
const U = require('../util');
const { E, clean } = U;
const R = require('../roles');
const H = require('../http');
const D = require('../domain');
const OPS = require('./ops');

const monthParam = (m) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(m || '') ? m : U.monthOf(U.todayStr()));
const payMonth = (p) => U.dateOf(p.paidAt || p.createdAt).slice(0, 7);
const income = (p) => (p.incomeAmount !== undefined ? p.incomeAmount : p.amount);

function financeData(ctx, month, propertyId) {
  const props = D.listScoped(db.properties, ctx).filter((p) => p.status !== 'archived' && (!propertyId || p.id === propertyId));
  const ids = new Set(props.map((p) => p.id));
  const inP = (r) => ids.has(r.propertyId);
  const pays = D.listScoped(db.payments, ctx).filter((p) => p.status === 'completed' && inP(p));
  const exps = D.listScoped(db.expenses, ctx).filter(inP);
  const invs = D.listScoped(db.invoices, ctx).filter((i) => i.status !== 'void' && inP(i));
  const units = D.listScoped(db.units, ctx).filter((u) => !u.archived && inP(u));
  const today = U.todayStr();

  const monthPays = pays.filter((p) => payMonth(p) === month);
  const monthExps = exps.filter((e) => e.date.startsWith(month));
  const sum = (a, f) => D.r2(a.reduce((x, y) => x + f(y), 0));
  const totalIncome = sum(monthPays, income); const totalExp = sum(monthExps, (e) => e.amount);
  const billed = invs.filter((i) => i.type !== 'deposit' && (i.period === month || (!i.period && i.dueDate.startsWith(month))));
  const expected = sum(billed, (i) => i.amount); const collected = sum(billed, (i) => i.paid);

  const group = (arr, key, val) => { const m = new Map(); for (const x of arr) m.set(key(x), D.r2((m.get(key(x)) || 0) + val(x))); return [...m].map(([k, v]) => ({ key: k, amount: v })).sort((a, b) => b.amount - a.amount); };
  const byProperty = props.map((p) => {
    const pu = units.filter((u) => u.propertyId === p.id);
    const inc = sum(monthPays.filter((x) => x.propertyId === p.id), income); const ex = sum(monthExps.filter((x) => x.propertyId === p.id), (e) => e.amount);
    const bl = billed.filter((i) => i.propertyId === p.id);
    return { id: p.id, name: p.name, units: pu.length, occupied: pu.filter((u) => u.status === 'occupied').length, income: inc, expenses: ex, net: D.r2(inc - ex), billed: sum(bl, (i) => i.amount), collected: sum(bl, (i) => i.paid) };
  });
  const openInv = invs.filter((i) => i.status === 'open' && i.amount - i.paid > 0.004);
  const overdue = openInv.filter((i) => i.dueDate < today);
  const trendMonths = U.lastMonths(6, month + '-01');
  const trend = trendMonths.map((m) => ({ month: m, income: sum(pays.filter((p) => payMonth(p) === m), income), expenses: sum(exps.filter((e) => e.date.startsWith(m)), (e) => e.amount) }));
  return {
    month, totalIncome, totalExpenses: totalExp, net: D.r2(totalIncome - totalExp), expected, collectedForPeriod: collected, collectionRate: expected ? Math.round((collected / expected) * 100) : null,
    arrears: sum(overdue, (i) => i.amount - i.paid), arrearsCount: new Set(overdue.map((i) => i.tenantId)).size, outstanding: sum(openInv, (i) => i.amount - i.paid),
    byMethod: group(monthPays, (p) => p.method, income).map((x) => ({ method: x.key, amount: x.amount })), byCategory: group(monthExps, (e) => e.category, (e) => e.amount).map((x) => ({ category: x.key, amount: x.amount })),
    byProperty, trend, paymentsCount: monthPays.length, expensesCount: monthExps.length,
    occupancy: units.length ? Math.round((units.filter((u) => u.status === 'occupied').length / units.length) * 100) : 0, units: units.length,
  };
}
H.route('GET', '/api/reports/finance', { perm: 'report.finance' }, async (ctx) => {
  const pid = ctx.query.propertyId ? D.getProperty(ctx.query.propertyId, ctx).id : null;
  const data = financeData(ctx, monthParam(ctx.query.month), pid);
  const o = db.users.get(ctx.scope.ownerId); const st = D.getSettings(ctx.scope.ownerId);
  return { report: data, org: (st && st.orgName) || (o && (o.company || o.name)) || '', generatedAt: Date.now(), generatedBy: ctx.user.name, scopeNote: ctx.scope.all ? 'All properties' : 'Assigned properties only' };
});

H.route('GET', '/api/reports/vacancy', { perm: 'report.vacancy' }, async (ctx) => {
  const today = U.todayStr();
  const props = new Map(D.listScoped(db.properties, ctx).filter((p) => p.status !== 'archived').map((p) => [p.id, p]));
  const units = D.listScoped(db.units, ctx).filter((u) => !u.archived && props.has(u.propertyId));
  const vacant = units.filter((u) => u.status === 'vacant').map((u) => ({ id: u.id, name: u.name, propertyId: u.propertyId, propertyName: props.get(u.propertyId).name, type: u.type, rent: u.rent, listed: !!u.listed, vacantSince: u.vacantSince || null, daysVacant: u.vacantSince ? Math.max(0, U.daysBetween(u.vacantSince, today)) : null, lostRent: D.r2(u.rent * ((u.vacantSince ? Math.max(0, U.daysBetween(u.vacantSince, today)) : 0) / 30)) }))
    .sort((a, b) => (b.daysVacant || 0) - (a.daysVacant || 0));
  const expiring = D.listScoped(db.leases, ctx).filter((l) => l.status === 'active' && l.endDate && U.daysBetween(today, l.endDate) <= 60).map((l) => ({ id: l.id, unitName: (db.units.get(l.unitId) || {}).name, tenantName: (db.users.get(l.tenantId) || {}).name, endDate: l.endDate, daysLeft: U.daysBetween(today, l.endDate), propertyName: (props.get(l.propertyId) || {}).name })).sort((a, b) => a.daysLeft - b.daysLeft);
  const byProperty = [...props.values()].map((p) => { const pu = units.filter((u) => u.propertyId === p.id); const occ = pu.filter((u) => u.status === 'occupied').length; return { id: p.id, name: p.name, units: pu.length, occupied: occ, vacant: pu.filter((u) => u.status === 'vacant').length, maintenance: pu.filter((u) => u.status === 'maintenance').length, occupancy: pu.length ? Math.round((occ / pu.length) * 100) : 0 }; });
  return { total: units.length, occupied: units.filter((u) => u.status === 'occupied').length, vacantCount: vacant.length, monthlyPotential: D.r2(vacant.reduce((a, u) => a + u.rent, 0)), vacant, expiring, byProperty };
});

function arrearsData(ctx) {
  const today = U.todayStr();
  const m = new Map();
  for (const i of D.listScoped(db.invoices, ctx)) {
    if (i.status !== 'open' || i.dueDate >= today || i.amount - i.paid <= 0.004) continue;
    const a = m.get(i.tenantId) || { tenantId: i.tenantId, balance: 0, oldest: i.dueDate, invoices: 0, unitId: i.unitId, propertyId: i.propertyId };
    a.balance = D.r2(a.balance + i.amount - i.paid); a.invoices++; if (i.dueDate < a.oldest) a.oldest = i.dueDate; m.set(i.tenantId, a);
  }
  return [...m.values()].map((a) => { const t = db.users.get(a.tenantId) || {}; return { ...a, tenantName: t.name || '', phone: t.phone || '', unitName: (db.units.get(a.unitId) || {}).name || '', propertyName: (db.properties.get(a.propertyId) || {}).name || '', daysOverdue: U.daysBetween(a.oldest, today) }; }).sort((a, b) => b.balance - a.balance);
}
H.route('GET', '/api/reports/arrears', { perm: 'rent.read' }, async (ctx) => { const rows = arrearsData(ctx); return { total: D.r2(rows.reduce((a, r) => a + r.balance, 0)), tenants: rows }; });
H.route('GET', '/api/reports/contractors', { perm: 'report.contractors' }, async (ctx) => ({ contractors: db.contractors.byOwner(ctx.scope.ownerId).map((c) => ({ id: c.id, name: c.name, trade: c.trade || '', ...OPS.contractorStats(c) })).sort((a, b) => b.completed - a.completed) }));

H.route('GET', '/api/reports/export', { perm: 'report.finance', rate: [20, 60000] }, async (ctx) => {
  const q = clean(ctx.query, { type: { t: 'e', values: ['payments', 'expenses', 'arrears', 'invoices'], req: true }, month: { t: 'm' } });
  const month = q.month || monthParam();
  let rows;
  const nm = { units: new Map(db.units.byOwner(ctx.scope.ownerId).map((x) => [x.id, x.name])), props: new Map(db.properties.byOwner(ctx.scope.ownerId).map((x) => [x.id, x.name])), ten: new Map(db.users.byOwner(ctx.scope.ownerId).map((x) => [x.id, x.name])) };
  if (q.type === 'payments') {
    rows = [['Receipt', 'Date', 'Property', 'Unit', 'Tenant', 'Method', 'Reference', 'Amount (KES)', 'Status']];
    for (const p of D.listScoped(db.payments, ctx).filter((x) => x.status === 'completed' && payMonth(x) === month).sort((a, b) => a.paidAt - b.paidAt)) rows.push([p.receiptNo, U.dateOf(p.paidAt), nm.props.get(p.propertyId), nm.units.get(p.unitId), nm.ten.get(p.tenantId), p.method, p.providerRef || p.bankRef || '', p.amount, p.simulated ? 'PRACTICE' : 'completed']);
  } else if (q.type === 'expenses') {
    rows = [['Date', 'Property', 'Category', 'Description', 'Vendor', 'Amount (KES)']];
    for (const e of D.listScoped(db.expenses, ctx).filter((x) => x.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date))) rows.push([e.date, nm.props.get(e.propertyId), e.category, e.description, e.vendor || '', e.amount]);
  } else if (q.type === 'invoices') {
    rows = [['Invoice', 'Due date', 'Property', 'Unit', 'Tenant', 'Description', 'Amount', 'Paid', 'Balance', 'Status']];
    for (const i of D.listScoped(db.invoices, ctx).map((x) => D.invView(x)).filter((x) => (x.period || x.dueDate.slice(0, 7)) === month)) rows.push([i.number, i.dueDate, nm.props.get(i.propertyId), nm.units.get(i.unitId), nm.ten.get(i.tenantId), i.desc, i.amount, i.paid, i.balance, i.state]);
  } else {
    rows = [['Tenant', 'Phone', 'Property', 'Unit', 'Balance (KES)', 'Days overdue', 'Oldest due date']];
    for (const a of arrearsData(ctx)) rows.push([a.tenantName, a.phone, a.propertyName, a.unitName, a.balance, a.daysOverdue, a.oldest]);
  }
  D.audit(ctx, 'report.exported', 'report', null, { type: q.type, month });
  ctx.send(200, Buffer.from('﻿' + U.toCsv(rows)), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${q.type}-${month}.csv"`, 'Cache-Control': 'no-store' });
});

/* ======================= DASHBOARD ======================= */
H.route('GET', '/api/dashboard', { skipGate: false }, async (ctx) => {
  const u = ctx.user; const today = U.todayStr(); const month = U.monthOf(today);
  if (u.role === 'national_admin') return { kind: 'national_admin' };
  if (u.role === 'tenant') {
    const lease = require('./money').leaseForTenant(u.id, u.ownerId);
    const invs = D.listScoped(db.invoices, ctx).map((i) => D.invView(i, today));
    const open = invs.filter((i) => i.state !== 'paid' && i.state !== 'void').sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const st = D.ensureSettings(u.ownerId);
    const unread = db.messages.byOwner(u.ownerId).filter((m) => m.tenantId === u.id && m.fromId !== u.id && !(m.readBy || []).includes(u.id)).length;
    const unit = lease ? db.units.get(lease.unitId) : null; const prop = lease ? db.properties.get(lease.propertyId) : null;
    return {
      kind: 'tenant', simulated: st.mode === 'simulate', lease: lease ? { id: lease.id, rent: lease.rent, dueDay: lease.dueDay, startDate: lease.startDate, endDate: lease.endDate, status: lease.status, credit: lease.credit || 0 } : null,
      unitName: unit ? unit.name : '', propertyName: prop ? prop.name : '', balance: lease ? D.leaseBalance(lease.id) : 0, nextDue: open[0] || null, overdueCount: open.filter((i) => i.state === 'overdue').length, openInvoices: open.slice(0, 6),
      recentPayments: D.listScoped(db.payments, ctx).filter((p) => p.status === 'completed').sort((a, b) => b.paidAt - a.paidAt).slice(0, 5).map((p) => ({ id: p.id, amount: p.amount, paidAt: p.paidAt, method: p.method, receiptNo: p.receiptNo })),
      openRequests: D.listScoped(db.maintenance, ctx).filter((m) => ['submitted', 'approved', 'assigned', 'in_progress'].includes(m.status)).length, unreadMessages: unread,
    };
  }
  if (u.role === 'contractor') {
    const jobs = ctx.scope.contractorId ? db.maintenance.byOwner(u.ownerId).filter((m) => m.contractorId === ctx.scope.contractorId) : [];
    return { kind: 'contractor', assigned: jobs.filter((m) => m.status === 'assigned').length, inProgress: jobs.filter((m) => m.status === 'in_progress').length, completed: jobs.filter((m) => m.status === 'completed').length, upcoming: jobs.filter((m) => ['assigned', 'in_progress'].includes(m.status)).slice(0, 6).map((m) => OPS.mView(m, ctx)) };
  }
  // landlord / manager / caretaker
  const units = D.listScoped(db.units, ctx).filter((x) => !x.archived);
  const maint = D.listScoped(db.maintenance, ctx);
  const open = maint.filter((m) => ['submitted', 'approved', 'assigned', 'in_progress'].includes(m.status));
  const base = {
    kind: u.role, units: units.length, occupied: units.filter((x) => x.status === 'occupied').length, vacant: units.filter((x) => x.status === 'vacant').length,
    properties: D.listScoped(db.properties, ctx).filter((p) => p.status !== 'archived').length,
    maintenance: { open: open.length, urgent: open.filter((m) => m.priority === 'urgent').length, waiting: maint.filter((m) => m.status === 'submitted').length, escalated: maint.filter((m) => m.status === 'submitted' && m.escalated).length },
    recent: open.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5).map((m) => OPS.mView(m, ctx)),
  };
  if (u.role === 'caretaker') return base;
  const f = financeData(ctx, month, null);
  const mode = D.ensureSettings(ctx.scope.ownerId).mode;
  const arrears = arrearsData(ctx);
  return {
    ...base, mode, finance: { month, income: f.totalIncome, expenses: f.totalExpenses, net: f.net, expected: f.expected, collected: f.collectedForPeriod, rate: f.collectionRate, arrears: f.arrears, arrearsCount: f.arrearsCount, trend: f.trend },
    topArrears: arrears.slice(0, 5), awaitingConfirmation: D.listScoped(db.payments, ctx).filter((p) => p.status === 'awaiting_confirmation').length,
    recentPayments: D.listScoped(db.payments, ctx).filter((p) => p.status === 'completed').sort((a, b) => b.paidAt - a.paidAt).slice(0, 6).map((p) => ({ id: p.id, amount: p.amount, paidAt: p.paidAt, method: p.method, receiptNo: p.receiptNo, tenantName: (db.users.get(p.tenantId) || {}).name, unitName: (db.units.get(p.unitId) || {}).name, simulated: !!p.simulated })),
    newEnquiries: R.can(u, 'inquiry.read') ? db.inquiries.byOwner(ctx.scope.ownerId).filter((i) => i.status === 'new' && (ctx.scope.all || ctx.scope.props.has(i.propertyId))).length : 0,
  };
});

/* ======================= PUBLIC: search verified rentals ======================= */
const mediaOf = (u) => { const fs_ = db.files.where('refId', u.id).filter((f) => f.refType === 'listing').sort((a, b) => (a.id === u.coverFileId ? -1 : b.id === u.coverFileId ? 1 : a.createdAt - b.createdAt)); return fs_.map((f) => ({ id: f.id, kind: f.mime.startsWith('video/') ? 'video' : f.tag === 'floorplan' ? 'floorplan' : 'photo' })); };
const LISTING_FIELDS = (u, p) => ({ media: mediaOf(u), bathrooms: u.bathrooms || null, furnished: !!u.furnished, availableFrom: u.availableFrom || null, tourUrl: u.tourUrl || '', postedAt: u.listedAt || u.updatedAt, id: u.id, type: u.type, bedrooms: u.bedrooms, rent: u.rent, deposit: u.deposit, description: u.description || '', floor: u.floor || '', property: p.name, county: p.county, town: p.town, amenities: p.amenities || [], propertyDescription: p.description || '', rules: p.rules || '', verified: true });
function listingsFor(q) {
  const owners = new Map();
  const ok = (p) => {
    if (!p || !p.verified || p.status !== 'active') return false;
    if (!owners.has(p.ownerId)) owners.set(p.ownerId, db.users.get(p.ownerId));
    const o = owners.get(p.ownerId); return !!o && o.status === 'active';
  };
  const props = new Map(db.properties.all().filter(ok).map((p) => [p.id, p]));
  let rows = db.units.where('listed', true).filter((u) => u.status === 'vacant' && !u.archived && props.has(u.propertyId));
  if (q.county) rows = rows.filter((u) => props.get(u.propertyId).county.toLowerCase() === q.county.toLowerCase());
  if (q.q) { const s = q.q.toLowerCase(); rows = rows.filter((u) => `${props.get(u.propertyId).town} ${props.get(u.propertyId).name} ${u.type} ${u.description || ''}`.toLowerCase().includes(s)); }
  if (q.minRent !== undefined) rows = rows.filter((u) => u.rent >= q.minRent);
  if (q.maxRent !== undefined) rows = rows.filter((u) => u.rent <= q.maxRent);
  if (q.type) rows = rows.filter((u) => u.type === q.type);
  if (q.bedrooms !== undefined) rows = rows.filter((u) => u.bedrooms >= q.bedrooms);
  return rows.sort((a, b) => a.rent - b.rent).map((u) => LISTING_FIELDS(u, props.get(u.propertyId)));
}
const LQ = { county: { t: 's', max: 40 }, q: { t: 's', max: 60 }, minRent: { t: 'n', max: 1e8 }, maxRent: { t: 'n', max: 1e8 }, type: { t: 's', max: 30 }, bedrooms: { t: 'n', int: true, max: 20 } };
H.route('GET', '/api/public/listings', { public: true, rate: [60, 60000] }, async (ctx) => {
  if (!require('../platform').config().listingsPublic) return { total: 0, counties: [], listings: [], disabled: true };
  const rows = listingsFor(clean(ctx.query, LQ));
  const counties = [...new Set(rows.map((r) => r.county))].sort();
  return { total: rows.length, counties, listings: rows.slice(0, 60) };
});
H.route('GET', '/api/public/listings/:id', { public: true, rate: [60, 60000] }, async (ctx) => {
  const l = listingsFor({}).find((x) => x.id === ctx.params.id);
  if (!l) throw E.notFound('This house is no longer available');
  return { listing: l };
});
H.route('POST', '/api/public/inquiry', { public: true, rate: [5, 600000] }, async (ctx) => {
  if (!require('../platform').config().listingsPublic) throw E.notFound();
  const b = clean(ctx.body, { unitId: { t: 'id', req: true }, name: { t: 's', req: true, min: 2, max: 80 }, phone: { t: 'phone', req: true }, message: { t: 's', max: 500 }, website: { t: 's', max: 50 } });
  if (b.website) return { ok: true }; // honeypot: bots fill hidden fields
  const l = listingsFor({}).find((x) => x.id === b.unitId);
  if (!l) throw E.notFound('This house is no longer available');
  const unit = db.units.get(b.unitId);
  db.inquiries.insert({ ownerId: unit.ownerId, propertyId: unit.propertyId, unitId: unit.id, name: b.name, phone: b.phone, message: b.message || '', status: 'new', ip: ctx.ip });
  D.notifyOrg(unit.ownerId, unit.propertyId, 'New enquiry', `${b.name} (${b.phone}) is interested in ${unit.type} at ${l.property}`, 'inquiry', '#/enquiries');
  return { ok: true, message: 'Thank you! The landlord or property manager will call you soon.' };
});
H.route('GET', '/api/public/info', { public: true }, async () => ({ name: require('../config').appName, ok: true }));

H.route('GET', '/api/inquiries', { perm: 'inquiry.read' }, async (ctx) => {
  const units = new Map(db.units.byOwner(ctx.scope.ownerId).map((x) => [x.id, x]));
  return { inquiries: D.listScoped(db.inquiries, ctx).sort((a, b) => b.createdAt - a.createdAt).slice(0, 200).map((i) => ({ id: i.id, name: i.name, phone: i.phone, message: i.message, status: i.status, at: i.createdAt, unitName: (units.get(i.unitId) || {}).name || '', type: (units.get(i.unitId) || {}).type || '', propertyName: (db.properties.get(i.propertyId) || {}).name || '' })) };
});
H.route('POST', '/api/inquiries/:id/status', { perm: 'inquiry.read' }, async (ctx) => {
  const b = clean(ctx.body, { status: { t: 'e', values: ['new', 'contacted', 'closed'], req: true } });
  const i = D.getScoped(db.inquiries, ctx.params.id, ctx);
  db.inquiries.update(i.id, { status: b.status });
  return { ok: true };
});

module.exports = { listingsFor, LQ, financeData, arrearsData };
