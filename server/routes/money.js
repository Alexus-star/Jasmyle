'use strict';
// Invoices, payments (M-Pesa STK Push, PayPal/cards, bank transfer, cash), receipts, expenses.
const S = require('../store');
const { db } = S;
const U = require('../util');
const { E, clean } = U;
const sec = require('../sec');
const R = require('../roles');
const H = require('../http');
const D = require('../domain');
const gw = require('../gateways');
const { log } = U;

const CATEGORIES = ['Repairs & maintenance', 'Utilities (water/electricity)', 'Security', 'Cleaning & garbage', 'Caretaker / staff wages', 'Taxes & licences', 'Insurance', 'Agent commission', 'Loan / mortgage', 'Marketing', 'Other'];

/* ======================= INVOICES ======================= */
const names = (ctx) => ({
  units: new Map(db.units.byOwner(ctx.scope.ownerId).map((x) => [x.id, x.name])),
  tenants: new Map(db.users.byOwner(ctx.scope.ownerId).filter((u) => u.role === 'tenant').map((x) => [x.id, x.name])),
  props: new Map(db.properties.byOwner(ctx.scope.ownerId).map((x) => [x.id, x.name])),
});
H.route('GET', '/api/invoices', { anyPerm: ['rent.read', 'rent.pay'] }, async (ctx) => {
  const today = U.todayStr();
  const n = names(ctx);
  let rows = D.listScoped(db.invoices, ctx).map((i) => D.invView(i, today));
  const q = ctx.query;
  if (q.state) rows = rows.filter((i) => i.state === q.state);
  if (q.propertyId) rows = rows.filter((i) => i.propertyId === q.propertyId);
  if (q.tenantId && ctx.scope.kind !== 'self') rows = rows.filter((i) => i.tenantId === q.tenantId);
  if (q.period) rows = rows.filter((i) => i.period === q.period);
  rows.sort((a, b) => b.dueDate.localeCompare(a.dueDate) || b.createdAt - a.createdAt);
  const total = rows.length;
  rows = rows.slice(0, Math.min(Number(q.limit) || 300, 1000));
  return { total, invoices: rows.map((i) => ({ ...i, unitName: n.units.get(i.unitId) || '', tenantName: n.tenants.get(i.tenantId) || '', propertyName: n.props.get(i.propertyId) || '' })) };
});
H.route('POST', '/api/invoices/charge', { perm: 'rent.charge' }, async (ctx) => {
  const b = clean(ctx.body, { tenantId: { t: 'id', req: true }, desc: { t: 's', req: true, max: 100, label: 'Description' }, amount: { t: 'n', req: true, min: 1, max: 1e8 }, dueDate: { t: 'd', req: true } });
  const t = D.getScoped(db.users, b.tenantId, ctx);
  const lease = db.leases.where('tenantId', t.id).find((l) => l.status === 'active');
  if (!lease) throw E.conflict('This tenant has no active lease.');
  D.getScoped(db.leases, lease.id, ctx);
  const inv = S.tx(() => {
    const i = D.createInvoice(lease, { type: 'charge', period: null, desc: b.desc, amount: b.amount, dueDate: b.dueDate });
    D.notify(t.id, 'New charge', `${b.desc}: ${D.fmtMoney(b.amount)} due ${b.dueDate}`, 'invoice', '#/home');
    D.audit(ctx, 'invoice.charge_added', 'invoice', i.id, { desc: b.desc, amount: b.amount });
    return i;
  });
  return { invoice: D.invView(inv) };
});
H.route('POST', '/api/invoices/:id/void', { perm: 'rent.void' }, async (ctx) => {
  const b = clean(ctx.body, { reason: { t: 's', req: true, max: 200, min: 3, label: 'Reason' } });
  const i = D.getScoped(db.invoices, ctx.params.id, ctx);
  if (i.status !== 'open') throw E.conflict('Only open invoices can be cancelled.');
  if (i.paid > 0) throw E.conflict('This invoice already has a payment. Reverse the payment first.');
  db.invoices.update(i.id, { status: 'void', voidReason: b.reason, voidedBy: ctx.user.id });
  D.audit(ctx, 'invoice.voided', 'invoice', i.id, { amount: i.amount, reason: b.reason });
  return { ok: true };
});

/* ======================= PAYMENTS (list, record, confirm, reverse, receipt) ======================= */
function payView(p, n) {
  const { tokenHash, ...rest } = p;
  return { ...rest, unitName: n.units.get(p.unitId) || '', tenantName: n.tenants.get(p.tenantId) || '', propertyName: n.props.get(p.propertyId) || '' };
}
H.route('GET', '/api/payments', { anyPerm: ['rent.read', 'rent.pay'] }, async (ctx) => {
  const n = names(ctx);
  let rows = D.listScoped(db.payments, ctx);
  const q = ctx.query;
  if (q.status) rows = rows.filter((p) => p.status === q.status);
  if (q.propertyId) rows = rows.filter((p) => p.propertyId === q.propertyId);
  if (q.method) rows = rows.filter((p) => p.method === q.method);
  if (q.month) rows = rows.filter((p) => U.dateOf(p.paidAt || p.createdAt).startsWith(q.month));
  if (q.tenantId && ctx.scope.kind !== 'self') rows = rows.filter((p) => p.tenantId === q.tenantId);
  rows.sort((a, b) => (b.paidAt || b.createdAt) - (a.paidAt || a.createdAt));
  const awaiting = rows.filter((p) => p.status === 'awaiting_confirmation').length;
  return { total: rows.length, awaitingConfirmation: awaiting, payments: rows.slice(0, 500).map((p) => payView(p, n)) };
});

function leaseForTenant(tenantId, ownerId) {
  const ls = db.leases.where('tenantId', tenantId).filter((l) => l.ownerId === ownerId).sort((a, b) => b.createdAt - a.createdAt);
  return ls.find((l) => l.status === 'active') || ls.find((l) => D.leaseBalance(l.id) > 0) || ls[0] || null;
}
H.route('POST', '/api/payments/record', { perm: 'rent.collect', rate: [60, 60000] }, async (ctx) => {
  const b = clean(ctx.body, {
    tenantId: { t: 'id', req: true }, amount: { t: 'n', req: true, min: 1, max: 1e8 }, method: { t: 'e', values: ['cash', 'bank', 'mpesa', 'cheque'], req: true },
    providerRef: { t: 's', max: 40, re: /^[A-Za-z0-9\-_/ ]*$/, label: 'Transaction code' }, paidDate: { t: 'd' }, note: { t: 's', max: 200 }, invoiceId: { t: 'id' },
  });
  const t = D.getScoped(db.users, b.tenantId, ctx);
  if (t.role !== 'tenant') throw E.notFound();
  if (['bank', 'mpesa', 'cheque'].includes(b.method) && !b.providerRef) throw E.bad('Enter the transaction code / reference so the payment can be traced.');
  const lease = leaseForTenant(t.id, ctx.scope.ownerId);
  if (!lease) throw E.conflict('This tenant has no lease.');
  D.getScoped(db.leases, lease.id, ctx);
  const paidAt = b.paidDate ? Date.parse(b.paidDate + 'T12:00:00+03:00') : Date.now();
  if (paidAt > Date.now() + 86400000) throw E.bad('Payment date cannot be in the future');
  const pay = S.tx(() => {
    const p = db.payments.insert({ ownerId: lease.ownerId, propertyId: lease.propertyId, unitId: lease.unitId, leaseId: lease.id, tenantId: t.id, amount: b.amount, method: b.method, status: 'pending', invoiceId: b.invoiceId, note: b.note || '', recordedBy: ctx.user.id, manual: true, ...(b.providerRef ? { providerRef: b.providerRef.toUpperCase() } : {}) });
    return D.completePayment(p.id, { paidAt }, ctx.user).payment;
  });
  return { payment: pay };
});
H.route('POST', '/api/payments/:id/confirm', { perm: 'rent.collect' }, async (ctx) => {
  const p = D.getScoped(db.payments, ctx.params.id, ctx);
  if (p.status !== 'awaiting_confirmation') throw E.conflict('This payment is not waiting for confirmation.');
  const extra = p.method === 'bank' && p.bankRef ? { providerRef: p.bankRef.toUpperCase(), confirmedBy: ctx.user.id } : { confirmedBy: ctx.user.id };
  const r = D.completePayment(p.id, extra, ctx.user);
  return { payment: r.payment };
});
H.route('POST', '/api/payments/:id/reject', { perm: 'rent.collect' }, async (ctx) => {
  const b = clean(ctx.body, { reason: { t: 's', req: true, max: 200, min: 3 } });
  const p = D.getScoped(db.payments, ctx.params.id, ctx);
  if (p.status !== 'awaiting_confirmation') throw E.conflict('This payment is not waiting for confirmation.');
  db.payments.update(p.id, { status: 'failed', failReason: b.reason, rejectedBy: ctx.user.id });
  D.notify(p.tenantId, 'Payment not confirmed', `We could not confirm your bank payment of ${D.fmtMoney(p.amount)}: ${b.reason}`, 'payment', '#/payments');
  D.audit(ctx, 'payment.rejected', 'payment', p.id, { reason: b.reason });
  return { ok: true };
});
H.route('POST', '/api/payments/:id/reverse', { perm: 'rent.void' }, async (ctx) => {
  const b = clean(ctx.body, { reason: { t: 's', req: true, max: 200, min: 3, label: 'Reason' } });
  const p = D.getScoped(db.payments, ctx.params.id, ctx);
  return { payment: D.reversePayment(p.id, b.reason, ctx.user, ctx.ip) };
});
H.route('GET', '/api/payments/:id/receipt', { anyPerm: ['rent.read', 'rent.pay'] }, async (ctx) => {
  const p = D.getScoped(db.payments, ctx.params.id, ctx);
  if (p.status !== 'completed') throw E.conflict('A receipt is only available for completed payments.');
  const t = db.users.get(p.tenantId); const unit = db.units.get(p.unitId); const prop = db.properties.get(p.propertyId); const owner = db.users.get(p.ownerId); const st = D.getSettings(p.ownerId);
  return {
    receipt: {
      receiptNo: p.receiptNo, paidAt: p.paidAt, amount: p.amount, method: p.method, reference: p.providerRef || p.bankRef || '', simulated: !!p.simulated,
      tenant: t ? t.name : '', phone: t ? t.phone : '', unit: unit ? unit.name : '', property: prop ? prop.name : '', address: prop ? [prop.address, prop.town].filter(Boolean).join(', ') : '',
      landlord: (st && st.orgName) || (owner && (owner.company || owner.name)) || '', allocations: p.allocations || [], credit: p.creditPart || 0, balanceNow: D.leaseBalance(p.leaseId),
    },
  };
});

/* ======================= ONLINE PAYMENTS BY TENANTS ======================= */
function resolveTarget(ctx, b) {
  const t = ctx.user;
  let lease; let invoice = null;
  if (b.invoiceId) {
    invoice = D.getScoped(db.invoices, b.invoiceId, ctx);
    if (invoice.status !== 'open') throw E.conflict('That invoice is already settled.');
    lease = db.leases.get(invoice.leaseId);
  } else lease = leaseForTenant(t.id, t.ownerId);
  if (!lease) throw E.conflict('You do not have a lease yet. Please contact your landlord.');
  const bal = D.leaseBalance(lease.id);
  if (bal <= 0) throw E.conflict('You have nothing to pay right now. Your account is fully paid.');
  const due = invoice ? D.r2(invoice.amount - invoice.paid) : bal;
  let amount = b.amount === undefined ? due : D.r2(b.amount);
  if (amount < 10) throw E.bad('The smallest online payment is KES 10');
  if (amount > bal + 0.001) throw E.bad(`You only owe ${D.fmtMoney(bal)}. Please enter that amount or less.`);
  return { lease, amount, invoice };
}
function orgSettings(ctx, lease) { return D.ensureSettings(lease.ownerId); }
function baseUrl(ctx) {
  const pu = D.publicUrl();
  if (pu) return pu;
  return `${ctx.secure ? 'https' : 'http'}://${ctx.req.headers.host}`;
}
function newPayment(ctx, lease, amount, invoice, method, extra) {
  const token = sec.randomToken(24);
  const pay = db.payments.insert({
    ownerId: lease.ownerId, propertyId: lease.propertyId, unitId: lease.unitId, leaseId: lease.id, tenantId: lease.tenantId, amount, method, status: 'pending',
    invoiceId: invoice ? invoice.id : undefined, tokenHash: sec.sha256(token), initiatedBy: ctx.user.id, ...extra,
  });
  return { pay, token };
}
const recentPending = (tenantId, ownerId, method, ms) => db.payments.byOwner(ownerId).some((p) => p.tenantId === tenantId && p.method === method && p.status === 'pending' && Date.now() - p.createdAt < ms);
const shortPay = (p) => ({ id: p.id, status: p.status, amount: p.amount, method: p.method, simulated: !!p.simulated, receiptNo: p.receiptNo || null, failReason: p.failReason || null });

H.route('GET', '/api/pay/options', { perm: 'rent.pay' }, async (ctx) => {
  const t = ctx.user; const lease = leaseForTenant(t.id, t.ownerId);
  const st = D.ensureSettings(t.ownerId);
  const sim = st.mode === 'simulate';
  const bal = lease ? D.leaseBalance(lease.id) : 0;
  return {
    balance: bal, simulated: sim,
    mpesa: sim || gw.mpesaReady(st.mpesa), paypal: sim || gw.paypalReady(st.paypal), card: sim || gw.paypalReady(st.paypal),
    bank: st.bank.enabled ? { bankName: st.bank.bankName, accountName: st.bank.accountName, accountNo: st.bank.accountNo, branch: st.bank.branch, instructions: st.bank.instructions, reference: lease ? (db.units.get(lease.unitId) || {}).name : '' } : null,
    usdRate: st.usdRate, phone: t.phone,
  };
});

H.route('POST', '/api/pay/mpesa', { perm: 'rent.pay', rate: [10, 60000] }, async (ctx) => {
  const b = clean(ctx.body, { amount: { t: 'n', min: 1, max: 1e6 }, phone: { t: 'phone' }, invoiceId: { t: 'id' } });
  const { lease, amount, invoice } = resolveTarget(ctx, b);
  const st = orgSettings(ctx, lease);
  const sim = st.mode === 'simulate';
  if (!sim && !gw.mpesaReady(st.mpesa)) throw E.conflict('M-Pesa is not set up for this landlord yet. Please use another method or contact your landlord.');
  const phone = b.phone || ctx.user.phone;
  if (!U.isKenyanMobile(phone)) throw E.bad('Enter a valid Safaricom number, for example 0712 345 678');
  if (recentPending(ctx.user.id, lease.ownerId, 'mpesa', 60000)) throw E.conflict('A payment request was just sent to your phone. Please enter your M-Pesa PIN on the phone, or wait a minute and try again.');
  const callbackBase = baseUrl(ctx);
  if (!sim && !/^https:\/\//.test(callbackBase)) throw E.unavailable('This system is not reachable from the internet yet, so M-Pesa cannot confirm payments. Ask the landlord to finish the setup guide.');
  const { pay, token } = newPayment(ctx, lease, amount, invoice, 'mpesa', { phone, simulated: sim, checkoutRequestId: sim ? 'SIM-' + sec.randomToken(8) : undefined });
  if (!sim) {
    try {
      const r = await gw.mpesaStkPush(st.mpesa, { phone, amount, reference: (db.units.get(lease.unitId) || {}).name || 'RENT', description: 'Rent', callbackUrl: `${callbackBase}/api/pay/mpesa/callback/${token}` });
      db.payments.update(pay.id, { checkoutRequestId: r.checkoutRequestId, merchantRequestId: r.merchantRequestId });
    } catch (e) { db.payments.update(pay.id, { status: 'failed', failReason: e.message }); throw e; }
  }
  D.audit(ctx, 'payment.initiated', 'payment', pay.id, { method: 'mpesa', amount, simulated: sim });
  return { payment: shortPay(db.payments.get(pay.id)), message: sim ? 'PRACTICE MODE: no real money will move. A fake M-Pesa approval will complete in a few seconds.' : 'Check your phone and enter your M-Pesa PIN to approve the payment.' };
});

H.route('POST', '/api/pay/paypal', { perm: 'rent.pay', rate: [10, 60000] }, async (ctx) => {
  const b = clean(ctx.body, { amount: { t: 'n', min: 1, max: 1e6 }, invoiceId: { t: 'id' } });
  const { lease, amount, invoice } = resolveTarget(ctx, b);
  const st = orgSettings(ctx, lease);
  const sim = st.mode === 'simulate';
  if (!sim && !gw.paypalReady(st.paypal)) throw E.conflict('PayPal / card payment is not set up for this landlord yet.');
  const usd = Math.max(0.01, Math.round((amount / st.usdRate) * 100) / 100);
  const { pay } = newPayment(ctx, lease, amount, invoice, 'paypal', { simulated: sim, usd, usdRate: st.usdRate });
  let approveUrl;
  if (sim) approveUrl = `/#/simulated-paypal/${pay.id}`;
  else {
    const base = baseUrl(ctx);
    try {
      const o = await gw.paypalCreateOrder(st.paypal, { paymentId: pay.id, usd, description: 'Rent ' + ((db.units.get(lease.unitId) || {}).name || ''), returnUrl: `${base}/api/pay/paypal/return?pid=${pay.id}`, cancelUrl: `${base}/api/pay/paypal/cancel?pid=${pay.id}` });
      db.payments.update(pay.id, { paypalOrderId: o.orderId });
      approveUrl = o.approveUrl;
    } catch (e) { db.payments.update(pay.id, { status: 'failed', failReason: e.message }); throw e; }
  }
  D.audit(ctx, 'payment.initiated', 'payment', pay.id, { method: 'paypal', amount, usd, simulated: sim });
  return { payment: shortPay(db.payments.get(pay.id)), approveUrl, usd };
});

H.route('POST', '/api/pay/paypal/simulate/:id', { perm: 'rent.pay' }, async (ctx) => {
  const p = D.getScoped(db.payments, ctx.params.id, ctx);
  if (!p.simulated || p.method !== 'paypal' || p.status !== 'pending') throw E.conflict('Nothing to approve.');
  const r = D.completePayment(p.id, { providerRef: 'SIMPP' + sec.randomToken(6).toUpperCase().replace(/[-_]/g, 'X') }, ctx.user);
  return { payment: shortPay(r.payment) };
});

async function finishPaypal(pid, orderId) {
  const p = db.payments.get(pid);
  if (!p || p.method !== 'paypal' || p.simulated || p.paypalOrderId !== orderId) return { ok: false };
  if (p.status === 'completed') return { ok: true, pid };
  const st = D.getSettings(p.ownerId);
  const cap = await gw.paypalCapture(st.paypal, orderId);
  if (!cap.ok) { db.payments.update(p.id, { status: 'failed', failReason: 'PayPal did not complete the payment' }); return { ok: false, pid }; }
  if (cap.customId && cap.customId !== p.id) return { ok: false, pid };
  if (cap.currency !== 'USD' || Math.abs(cap.usd - p.usd) > 0.01) {
    db.payments.update(p.id, { status: 'awaiting_confirmation', providerRef: cap.captureId, note: `Amount differs: expected USD ${p.usd}, received ${cap.currency} ${cap.usd}` });
    D.notifyOrg(p.ownerId, p.propertyId, 'Payment needs review', `A PayPal payment amount did not match. Please review it in Payments.`, 'payment', '#/payments');
    return { ok: true, pid, review: true };
  }
  try { D.completePayment(p.id, { providerRef: cap.captureId }); } catch (e) { if (e.code !== 'duplicate') throw e; }
  return { ok: true, pid };
}
H.route('GET', '/api/pay/paypal/return', { public: true, noCsrf: true, rate: [30, 60000] }, async (ctx) => {
  try {
    const r = await finishPaypal(String(ctx.query.pid || ''), String(ctx.query.token || ''));
    ctx.redirect(`/#/pay-result/${encodeURIComponent(ctx.query.pid || '')}?ok=${r.ok ? 1 : 0}`);
  } catch (e) { log('error', 'paypal return failed: ' + e.message); ctx.redirect(`/#/pay-result/${encodeURIComponent(ctx.query.pid || '')}?ok=0`); }
});
H.route('GET', '/api/pay/paypal/cancel', { public: true, noCsrf: true, rate: [30, 60000] }, async (ctx) => {
  const p = db.payments.get(String(ctx.query.pid || ''));
  if (p && p.status === 'pending' && p.method === 'paypal') db.payments.update(p.id, { status: 'failed', failReason: 'Cancelled by you' });
  ctx.redirect(`/#/pay-result/${encodeURIComponent(ctx.query.pid || '')}?ok=0`);
});

H.route('POST', '/api/pay/bank', { perm: 'rent.pay', rate: [10, 60000] }, async (ctx) => {
  const b = clean(ctx.body, { amount: { t: 'n', min: 1, max: 1e8 }, invoiceId: { t: 'id' }, bankRef: { t: 's', req: true, min: 4, max: 40, re: /^[A-Za-z0-9\-_/ ]+$/, label: 'Bank transaction reference' }, note: { t: 's', max: 200 } });
  const { lease, amount, invoice } = resolveTarget(ctx, b);
  const st = orgSettings(ctx, lease);
  if (!st.bank.enabled) throw E.conflict('Bank payment is not available for this landlord.');
  const dup = db.payments.byOwner(lease.ownerId).find((p) => p.bankRef && p.bankRef.toUpperCase() === b.bankRef.toUpperCase() && p.status !== 'failed');
  if (dup) throw E.conflict('That bank reference was already submitted.');
  const { pay } = newPayment(ctx, lease, amount, invoice, 'bank', { bankRef: b.bankRef, note: b.note || '', status: 'awaiting_confirmation' });
  D.notifyOrg(lease.ownerId, lease.propertyId, 'Bank payment to confirm', `${ctx.user.name} says they paid ${D.fmtMoney(amount)} (ref ${b.bankRef}). Check your bank statement and confirm.`, 'payment', '#/payments');
  D.audit(ctx, 'payment.bank_submitted', 'payment', pay.id, { amount, ref: b.bankRef });
  return { payment: shortPay(pay), message: 'Thank you. Your payment will show as paid once the landlord confirms it on the bank statement.' };
});

/** Poll while the customer approves on their phone. Also repairs lost callbacks. */
H.route('GET', '/api/pay/status/:id', { anyPerm: ['rent.pay', 'rent.read'] }, async (ctx) => {
  let p = D.getScoped(db.payments, ctx.params.id, ctx);
  if (p.status === 'pending') {
    const age = Date.now() - p.createdAt;
    if (p.simulated && p.method === 'mpesa' && age > 4000) p = D.completePayment(p.id, { providerRef: 'SIM' + sec.randomToken(7).toUpperCase().replace(/[-_]/g, 'X') }).payment;
    else if (!p.simulated && p.method === 'mpesa' && p.checkoutRequestId && age > 20000 && Date.now() - (p.lastQueryAt || 0) > 8000) p = await reconcileMpesa(p);
  }
  return { payment: shortPay(p) };
});
async function reconcileMpesa(p) {
  const st = D.getSettings(p.ownerId);
  db.payments.update(p.id, { lastQueryAt: Date.now() });
  try {
    const q = await gw.mpesaStkQuery(st.mpesa, p.checkoutRequestId);
    if (!q.final) return db.payments.get(p.id);
    if (q.code === 0) return D.completePayment(p.id, { providerRef: 'CHK:' + p.checkoutRequestId }).payment;
    return db.payments.update(p.id, { status: 'failed', failReason: q.desc || 'The payment was not approved' });
  } catch (e) { return db.payments.get(p.id); }
}

H.route('POST', '/api/pay/mpesa/callback/:token', { public: true, noCsrf: true, rate: [120, 60000] }, async (ctx) => {
  const ok = { ResultCode: 0, ResultDesc: 'Accepted' };
  const cb = gw.parseMpesaCallback(ctx.body);
  const p = db.payments.find('tokenHash', sec.sha256(String(ctx.params.token).slice(0, 80)));
  if (!cb || !p || p.method !== 'mpesa' || p.checkoutRequestId !== cb.checkoutRequestId) {
    S.audit.append({ action: 'security.bad_callback', ip: ctx.ip, detail: { found: !!p } });
    return ok; // never tell an attacker what failed
  }
  try {
    if (cb.code === 0) {
      if (cb.amount !== undefined && Math.abs(cb.amount - p.amount) > 0.5) {
        db.payments.update(p.id, { status: 'awaiting_confirmation', providerRef: cb.receipt, note: `Amount differs: expected ${p.amount}, M-Pesa says ${cb.amount}` });
        D.notifyOrg(p.ownerId, p.propertyId, 'Payment needs review', 'An M-Pesa payment amount did not match the request. Please review it in Payments.', 'payment', '#/payments');
      } else if (p.status === 'completed') {
        if (String(p.providerRef || '').startsWith('CHK:') && cb.receipt) db.payments.update(p.id, { providerRef: cb.receipt }); // replace placeholder with the real M-Pesa code
      } else D.completePayment(p.id, { providerRef: cb.receipt, phone: cb.phone || p.phone });
    } else if (p.status === 'pending') {
      db.payments.update(p.id, { status: 'failed', failReason: cb.desc || 'The payment was not approved' });
      D.notify(p.tenantId, 'Payment not completed', cb.desc || 'The M-Pesa payment was cancelled or failed.', 'payment', '#/payments');
    }
  } catch (e) { log('error', 'mpesa callback processing failed: ' + e.message, { payment: p.id }); }
  return ok;
});

/* ======================= EXPENSES ======================= */
const EXP_FIELDS = {
  propertyId: { t: 'id', req: true }, category: { t: 'e', values: CATEGORIES, req: true }, amount: { t: 'n', req: true, min: 1, max: 1e9 }, date: { t: 'd', req: true },
  description: { t: 's', req: true, max: 200, label: 'Description' }, vendor: { t: 's', max: 100 },
};
H.route('GET', '/api/expenses', { perm: 'expense.read' }, async (ctx) => {
  const n = names(ctx);
  let rows = D.listScoped(db.expenses, ctx);
  const q = ctx.query;
  if (q.month) rows = rows.filter((e) => e.date.startsWith(q.month));
  if (q.propertyId) rows = rows.filter((e) => e.propertyId === q.propertyId);
  if (q.category) rows = rows.filter((e) => e.category === q.category);
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  return { categories: CATEGORIES, total: D.r2(rows.reduce((a, e) => a + e.amount, 0)), expenses: rows.slice(0, 1000).map((e) => ({ ...e, propertyName: n.props.get(e.propertyId) || '' })) };
});
H.route('POST', '/api/expenses', { perm: 'expense.write' }, async (ctx) => {
  const b = clean(ctx.body, EXP_FIELDS);
  const p = D.getProperty(b.propertyId, ctx);
  const e = db.expenses.insert({ ownerId: p.ownerId, ...b, createdBy: ctx.user.id });
  D.audit(ctx, 'expense.created', 'expense', e.id, { amount: e.amount, category: e.category });
  return { expense: e };
});
H.route('PUT', '/api/expenses/:id', { perm: 'expense.write' }, async (ctx) => {
  const e = D.getScoped(db.expenses, ctx.params.id, ctx);
  const { propertyId, ...f } = EXP_FIELDS;
  const b = clean(ctx.body, { ...f, version: { t: 'n', req: true, int: true } });
  const { version, ...patch } = b;
  const up = db.expenses.update(e.id, patch, version);
  D.audit(ctx, 'expense.updated', 'expense', e.id, { before: { amount: e.amount, category: e.category }, after: { amount: up.amount, category: up.category } });
  return { expense: up };
});
H.route('DELETE', '/api/expenses/:id', { perm: 'expense.delete' }, async (ctx) => {
  const e = D.getScoped(db.expenses, ctx.params.id, ctx);
  db.expenses.remove(e.id);
  D.audit(ctx, 'expense.deleted', 'expense', e.id, { amount: e.amount, category: e.category, description: e.description });
  return { ok: true };
});

module.exports = { CATEGORIES, leaseForTenant };
