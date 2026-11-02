'use strict';
// Shared business logic. Everything that changes money runs inside a database transaction.
const S = require('./store');
const { db } = S;
const U = require('./util');
const { E } = U;
const R = require('./roles');
const sec = require('./sec');
const gw = require('./gateways');
const { log } = U;

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const pad = (n, w = 6) => String(n).padStart(w, '0');

/* ---------- audit helper ---------- */
function audit(ctx, action, entity, entityId, detail) {
  const u = ctx.user;
  try {
    S.audit.append({ owner: u ? (u.ownerId || null) : null, actor: u ? u.id : null, role: u ? u.role : null, action, entity, entityId, ip: ctx.ip, detail });
  } catch (e) { log('error', 'audit failed: ' + e.message); }
}

/* ---------- per-landlord settings ---------- */
function defaultSettings(ownerId) {
  const pd = (S.meta.get('platform:config', {}) || {}).defaults || {};
  return {
    ownerId, mode: 'simulate', orgName: '', reminderDays: pd.reminderDays ?? 3, invoiceLeadDays: 5, usdRate: pd.usdRate ?? 129, overdueRepeatDays: 7,
    mpesa: { enabled: false, env: 'sandbox', type: 'paybill', shortcode: '', partyB: '', consumerKeyEnc: '', consumerSecretEnc: '', passkeyEnc: '' },
    paypal: { enabled: false, mode: 'sandbox', clientIdEnc: '', secretEnc: '' },
    bank: { enabled: true, bankName: '', accountName: '', accountNo: '', branch: '', instructions: '' },
    sms: { enabled: false, username: '', apiKeyEnc: '', senderId: '' },
  };
}
const getSettings = (ownerId) => db.settings.byOwner(ownerId)[0] || null;
const ensureSettings = (ownerId) => getSettings(ownerId) || db.settings.insert(defaultSettings(ownerId));
const publicUrl = () => S.meta.get('publicUrl') || require('./config').publicUrl || '';

/* ---------- notifications ---------- */
function notify(userId, title, body, kind = 'info', link = '') {
  if (!userId) return;
  db.notifications.insert({ userId, title, body, kind, link, read: false });
}
function orgRecipients(ownerId, propertyId, { caretakers = false } = {}) {
  return db.users.byOwner(ownerId).filter((u) => u.status === 'active' && (
    u.role === 'landlord' ||
    (u.role === 'property_manager' && propertyId && (u.assignedPropertyIds || []).includes(propertyId)) ||
    (caretakers && u.role === 'caretaker' && propertyId && (u.assignedPropertyIds || []).includes(propertyId))));
}
function notifyOrg(ownerId, propertyId, title, body, kind, link, opts) {
  for (const u of orgRecipients(ownerId, propertyId, opts)) notify(u.id, title, body, kind, link);
}
function smsTo(ownerId, phone, text) {
  const st = getSettings(ownerId);
  if (!st || !st.sms || !st.sms.enabled || !phone) return;
  gw.sendSms(st.sms, phone, text).catch(() => {});
}

/* ---------- scoping ---------- */
function listScoped(col, ctx) {
  const s = ctx.scope;
  if (s.kind === 'org') {
    const rows = col.byOwner(s.ownerId);
    return s.all ? rows : rows.filter((r) => r.propertyId && s.props.has(r.propertyId));
  }
  if (s.kind === 'self') return col.byOwner(s.ownerId).filter((r) => r.tenantId === s.tenantId);
  return [];
}
function getScoped(col, id, ctx) {
  const rec = col.get(id);
  if (!rec || !R.inScope(ctx.scope, rec)) throw E.notFound(); // 404, never 403: do not reveal that it exists
  return rec;
}
/** Org records that may have no property (sales, leads, deals, projects...): landlord sees all; staff see their properties' records and their own. */
function orgList(col, ctx) {
  const s = ctx.scope; if (s.kind !== 'org') return [];
  const rows = col.byOwner(s.ownerId);
  return s.all ? rows : rows.filter((r) => (r.propertyId && s.props.has(r.propertyId)) || r.createdBy === ctx.user.id);
}
function orgGet(col, id, ctx) {
  const rec = typeof id === 'string' ? col.get(id) : null; const s = ctx.scope;
  if (!rec || s.kind !== 'org' || rec.ownerId !== s.ownerId || !(s.all || (rec.propertyId && s.props.has(rec.propertyId)) || rec.createdBy === ctx.user.id)) throw E.notFound();
  return rec;
}
function getProperty(id, ctx) {
  const p = db.properties.get(id);
  if (!p || !R.propInScope(ctx.scope, p)) throw E.notFound('Property not found');
  return p;
}
function requirePropertyIds(ctx, ids) {
  return ids.map((id) => getProperty(id, ctx).id);
}
const need = (ctx, perm) => { if (!R.can(ctx.user, perm)) throw E.forbidden(); };
const requireVersion = (b) => { if (!Number.isInteger(b.version)) throw E.bad('Missing record version. Please reload the page.'); return b.version; };

/* ---------- invoices ---------- */
function invView(i, today = U.todayStr()) {
  const balance = Math.max(0, r2(i.amount - i.paid));
  let state;
  if (i.status === 'void') state = 'void';
  else if (balance <= 0) state = 'paid';
  else if (i.dueDate < today) state = 'overdue';
  else state = i.paid > 0 ? 'partial' : 'due';
  return { ...i, balance, state, daysOverdue: state === 'overdue' ? U.daysBetween(i.dueDate, today) : 0 };
}
const nextInvoiceNo = (ownerId) => 'INV-' + pad(S.meta.incr('inv:' + ownerId));

function applyCreditToInvoice(lease, inv) {
  const credit = r2(lease.credit || 0);
  if (credit <= 0) return inv;
  const use = Math.min(credit, r2(inv.amount - inv.paid));
  if (use <= 0) return inv;
  db.leases.update(lease.id, (l) => { l.credit = r2((l.credit || 0) - use); return l; });
  return db.invoices.update(inv.id, (i) => {
    i.paid = r2(i.paid + use); i.creditApplied = use;
    if (i.amount - i.paid <= 0.004) { i.status = 'paid'; i.paidAt = Date.now(); }
    return i;
  });
}
function createInvoice(lease, fields) {
  const inv = { ownerId: lease.ownerId, propertyId: lease.propertyId, unitId: lease.unitId, leaseId: lease.id, tenantId: lease.tenantId, paid: 0, status: 'open', number: nextInvoiceNo(lease.ownerId), ...fields };
  inv.amount = r2(inv.amount);
  let rec;
  try { rec = db.invoices.insert(inv); } catch (e) { if (e.code === 'duplicate') return null; throw e; }
  const fresh = db.leases.get(lease.id);
  return applyCreditToInvoice(fresh, rec);
}
/** Make sure every month from move-in to this month has a rent invoice. Safe to run any number of times. */
function generateForLease(lease, today = U.todayStr()) {
  if (lease.status !== 'active') return 0;
  const st = getSettings(lease.ownerId) || defaultSettings(lease.ownerId);
  const cur = U.monthOf(today);
  let from = U.monthOf(lease.startDate);
  const floor = U.addMonths(cur, -11);
  if (from < floor) from = floor;
  if (lease.billFrom && from < lease.billFrom) from = lease.billFrom; // imported tenants: do not back-bill months before the system was used
  const endM = lease.endDate ? U.monthOf(lease.endDate) : '9999-99';
  let made = 0;
  for (let p = from; p <= cur && p <= endM; p = U.addMonths(p, 1)) {
    const due = U.dueDateFor(p, lease.dueDay || 1);
    if (p === cur && U.daysBetween(today, due) > st.invoiceLeadDays) continue; // not time yet
    const amount = p === U.monthOf(lease.startDate) && lease.firstRent ? lease.firstRent : lease.rent;
    const inv = createInvoice(lease, { type: 'rent', period: p, desc: 'Rent ' + p, amount, dueDate: due });
    if (inv) made++;
  }
  return made;
}

/* ---------- payments ---------- */
function allocate(pay) {
  let left = r2(pay.amount);
  const allocs = []; let deposit = 0;
  let invs = db.invoices.where('leaseId', pay.leaseId).filter((i) => i.status === 'open' && i.amount - i.paid > 0.004)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.createdAt - b.createdAt);
  if (pay.invoiceId) { // tenant chose a specific invoice: pay that first
    const first = invs.find((i) => i.id === pay.invoiceId);
    if (first) invs = [first, ...invs.filter((i) => i.id !== first.id)];
  }
  for (const inv of invs) {
    if (left <= 0.004) break;
    const take = Math.min(r2(inv.amount - inv.paid), left);
    db.invoices.update(inv.id, (c) => { c.paid = r2(c.paid + take); if (c.amount - c.paid <= 0.004) { c.status = 'paid'; c.paidAt = Date.now(); } return c; });
    allocs.push({ invoiceId: inv.id, amount: take, type: inv.type, period: inv.period || null, desc: inv.desc });
    if (inv.type === 'deposit') deposit = r2(deposit + take);
    left = r2(left - take);
  }
  let credit = 0;
  if (left > 0.004) { credit = left; db.leases.update(pay.leaseId, (l) => { l.credit = r2((l.credit || 0) + credit); return l; }); }
  return { allocs, credit, deposit };
}

/** Idempotent: calling twice (e.g. M-Pesa callback arrives twice) credits the money only once. */
function completePayment(id, extra = {}, actor = null) {
  return S.tx(() => {
    const p = db.payments.get(id);
    if (!p) throw E.notFound('Payment not found');
    if (p.status === 'completed') return { payment: p, already: true };
    if (p.status === 'reversed') throw E.conflict('This payment was reversed and cannot be completed.');
    const al = allocate(p);
    const receiptNo = 'RCT-' + pad(S.meta.incr('rcpt:' + p.ownerId));
    const upd = db.payments.update(id, (c) => {
      Object.assign(c, extra, { status: 'completed', paidAt: extra.paidAt || Date.now(), receiptNo, allocations: al.allocs, creditPart: al.credit, depositPart: al.deposit, incomeAmount: r2(c.amount - al.deposit), failReason: null });
      return c;
    });
    const unit = db.units.get(p.unitId);
    const money = 'KES ' + p.amount.toLocaleString('en-KE');
    notify(p.tenantId, 'Payment received', `${money} received. Receipt ${receiptNo}.`, 'payment', '#/payments');
    notifyOrg(p.ownerId, p.propertyId, 'Rent received', `${money} for ${unit ? unit.name : 'a unit'} via ${p.method.toUpperCase()} (${receiptNo}).`, 'payment', '#/payments');
    S.audit.append({ owner: p.ownerId, actor: actor ? actor.id : null, role: actor ? actor.role : 'system', action: 'payment.completed', entity: 'payment', entityId: id, detail: { amount: p.amount, method: p.method, receiptNo, ref: upd.providerRef || null } });
    return { payment: upd };
  });
}
function reversePayment(id, reason, actor, ip) {
  return S.tx(() => {
    const p = db.payments.get(id);
    if (!p || p.status !== 'completed') throw E.conflict('Only completed payments can be reversed.');
    for (const a of p.allocations || []) {
      db.invoices.update(a.invoiceId, (c) => { c.paid = r2(Math.max(0, c.paid - a.amount)); if (c.status === 'paid' && c.amount - c.paid > 0.004) { c.status = 'open'; c.paidAt = null; } return c; });
    }
    if (p.creditPart) db.leases.update(p.leaseId, (l) => { l.credit = r2((l.credit || 0) - p.creditPart); return l; });
    const upd = db.payments.update(id, (c) => { c.status = 'reversed'; c.reversedAt = Date.now(); c.reversedBy = actor.id; c.reverseReason = reason; return c; });
    S.audit.append({ owner: p.ownerId, actor: actor.id, role: actor.role, action: 'payment.reversed', entity: 'payment', entityId: id, ip, detail: { amount: p.amount, reason } });
    return upd;
  });
}
function tenantBalance(tenantId, ownerId) {
  const invs = db.invoices.byOwner(ownerId).filter((i) => i.tenantId === tenantId && i.status === 'open');
  return r2(invs.reduce((a, i) => a + Math.max(0, i.amount - i.paid), 0));
}
function leaseBalance(leaseId) {
  return r2(db.invoices.where('leaseId', leaseId).filter((i) => i.status === 'open').reduce((a, i) => a + Math.max(0, i.amount - i.paid), 0));
}

/* ---------- people ---------- */
function userPublic(u) {
  if (!u) return null;
  const { passHash, totp, recovery, nationalIdEnc, ...rest } = u;
  return { ...rest, mfaEnabled: !!(totp && totp.enabled) };
}
async function makeUser(fields, { password, mustChange = true } = {}) {
  const temp = password || sec.genPassword();
  const id = U.newId('usr');
  const rec = { id, ...fields, ownerId: fields.role === 'landlord' ? id : fields.ownerId, passHash: await sec.hashPassword(temp), mustChangePassword: mustChange, status: fields.status || 'active', failed: 0, lockedUntil: 0 };
  const saved = db.users.insert(rec);
  return { user: saved, tempPassword: password ? null : temp };
}
const fmtMoney = (n) => 'KES ' + Number(n).toLocaleString('en-KE', { maximumFractionDigits: 2 });

module.exports = {
  r2, pad, audit, defaultSettings, getSettings, ensureSettings, publicUrl, notify, notifyOrg, orgRecipients, smsTo,
  listScoped, getScoped, orgList, orgGet, getProperty, requirePropertyIds, need, requireVersion,
  invView, nextInvoiceNo, createInvoice, generateForLease, allocate, completePayment, reversePayment, tenantBalance, leaseBalance,
  userPublic, makeUser, fmtMoney,
};
