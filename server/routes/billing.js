'use strict';
// Platform fee (what the National Administrator earns per unit managed), landlord billing screens,
// platform-wide settings, signed rules packs and integration health.
const S = require('../store');
const { db } = S;
const U = require('../util');
const { E, clean, log } = U;
const sec = require('../sec');
const gw = require('../gateways');
const rules = require('../rules');
const H = require('../http');
const D = require('../domain');
const P = require('../platform');

const MASK = '••••••••';
const needSuper = (ctx) => { if (!ctx.user.isSuper) throw E.forbidden('Only the super administrator can change prices, payout accounts and tax rules.'); };
const baseUrl = (ctx) => D.publicUrl() || `${ctx.secure ? 'https' : 'http'}://${ctx.req.headers.host}`;
const sim = () => P.config().payout.mode === 'simulate';
const feeInvView = (i) => ({ id: i.id, invoiceNo: i.invoiceNo, period: i.period, desc: i.desc, amount: i.amount, paid: i.paid, balance: U.r2 ? U.r2(i.amount - i.paid) : Math.round((i.amount - i.paid) * 100) / 100, status: i.status, issued: i.issued, dueDate: i.dueDate, quote: i.quote, late: i.status === 'open' ? Math.max(0, U.daysBetween(i.dueDate, U.todayStr())) : 0 });
const payView = (p) => ({ id: p.id, status: p.status, amount: p.amount, method: p.method, simulated: !!p.simulated, failReason: p.failReason || null, providerRef: p.providerRef || null, paidAt: p.paidAt || null, createdAt: p.createdAt, invoiceId: p.invoiceId });

/* ============ public config (announcement banner, registration mode, support contacts) ============ */
H.route('GET', '/api/public/config', { public: true, rate: [120, 60000] }, async () => ({ ...P.publicConfig(), appName: require('../config').appName }));

/* ============ landlord: platform fee ============ */
H.route('GET', '/api/billing', { perm: 'billing.read', roles: ['landlord'] }, async (ctx) => {
  const o = db.users.get(ctx.scope.ownerId); const c = P.config(); const po = c.payout;
  const invs = db.plat_invoices.byOwner(o.id).sort((a, b) => b.createdAt - a.createdAt).map(feeInvView);
  const pays = db.plat_payments.byOwner(o.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 30).map(payView);
  return {
    trial: { active: P.inTrial(o), until: P.trialEnd(o) }, estimate: P.quoteFor(o.id), invoices: invs, payments: pays, onHold: P.onHold(o.id), graceDays: c.graceDays,
    pricing: { tiers: c.pricing.tiers, percentOfRent: c.pricing.percentOfRent, minMonthly: c.pricing.minMonthly, countVacant: c.pricing.countVacant, vatPercent: c.pricing.vatPercent },
    waived: !!(o.billing && o.billing.waived), discountPct: (o.billing && o.billing.discountPct) || 0,
    options: { simulated: po.mode === 'simulate', mpesa: po.mode === 'simulate' || gw.mpesaReady(po.mpesa), paypal: po.mode === 'simulate' || gw.paypalReady(po.paypal), usdRate: po.usdRate,
      bank: po.bank.enabled ? { bankName: po.bank.bankName, accountName: po.bank.accountName, accountNo: po.bank.accountNo, branch: po.bank.branch, instructions: po.bank.instructions } : null },
    support: c.support, phone: ctx.user.phone,
  };
});
function pickInvoice(ctx, id) {
  const inv = db.plat_invoices.get(id);
  if (!inv || inv.ownerId !== ctx.scope.ownerId) throw E.notFound();
  if (inv.status !== 'open' || inv.amount - inv.paid <= 0.004) throw E.conflict('That invoice is already settled.');
  return inv;
}
const newFeePayment = (ctx, inv, method, extra) => {
  const token = sec.randomToken(24); const amount = Math.round((inv.amount - inv.paid) * 100) / 100;
  const pay = db.plat_payments.insert({ ownerId: inv.ownerId, invoiceId: inv.id, amount, method, status: 'pending', tokenHash: sec.sha256(token), initiatedBy: ctx.user.id, ...extra });
  return { pay, token };
};
H.route('POST', '/api/billing/pay/mpesa', { perm: 'billing.read', roles: ['landlord'], rate: [8, 60000] }, async (ctx) => {
  const b = clean(ctx.body, { invoiceId: { t: 'id', req: true }, phone: { t: 'phone' } });
  const inv = pickInvoice(ctx, b.invoiceId); const po = P.config().payout; const simu = po.mode === 'simulate';
  if (!simu && !gw.mpesaReady(po.mpesa)) throw E.conflict('M-Pesa is not set up for platform fees yet. Use another method or contact support.');
  const phone = b.phone || ctx.user.phone; if (!U.isKenyanMobile(phone)) throw E.bad('Enter a valid Safaricom number, for example 0712 345 678');
  const cb = baseUrl(ctx); if (!simu && !/^https:\/\//.test(cb)) throw E.unavailable('The system has no public https address yet, so M-Pesa cannot confirm payments.');
  const { pay, token } = newFeePayment(ctx, inv, 'mpesa', { phone, simulated: simu, checkoutRequestId: simu ? 'SIM-' + sec.randomToken(8) : undefined });
  if (!simu) {
    try { const r = await gw.mpesaStkPush(po.mpesa, { phone, amount: pay.amount, reference: inv.invoiceNo, description: 'Platform fee', callbackUrl: `${cb}/api/billing/mpesa/callback/${token}` }); db.plat_payments.update(pay.id, { checkoutRequestId: r.checkoutRequestId }); }
    catch (e) { db.plat_payments.update(pay.id, { status: 'failed', failReason: e.message }); throw e; }
  }
  D.audit(ctx, 'billing.fee_initiated', 'plat_payment', pay.id, { method: 'mpesa', amount: pay.amount, simulated: simu });
  return { payment: payView(db.plat_payments.get(pay.id)), message: simu ? 'PRACTICE MODE: no real money moves. A fake approval completes in a few seconds.' : 'Check your phone and enter your M-Pesa PIN.' };
});
H.route('POST', '/api/billing/pay/paypal', { perm: 'billing.read', roles: ['landlord'], rate: [8, 60000] }, async (ctx) => {
  const b = clean(ctx.body, { invoiceId: { t: 'id', req: true } });
  const inv = pickInvoice(ctx, b.invoiceId); const po = P.config().payout; const simu = po.mode === 'simulate';
  if (!simu && !gw.paypalReady(po.paypal)) throw E.conflict('PayPal / card is not set up for platform fees yet.');
  const usd = Math.max(0.01, Math.round(((inv.amount - inv.paid) / po.usdRate) * 100) / 100);
  const { pay } = newFeePayment(ctx, inv, 'paypal', { simulated: simu, usd });
  let approveUrl;
  if (simu) approveUrl = null; else {
    const base = baseUrl(ctx);
    try { const o = await gw.paypalCreateOrder(po.paypal, { paymentId: pay.id, usd, description: 'Jasmyle Properties fee ' + inv.invoiceNo, returnUrl: `${base}/api/billing/paypal/return?pid=${pay.id}`, cancelUrl: `${base}/api/billing/paypal/cancel?pid=${pay.id}` }); db.plat_payments.update(pay.id, { paypalOrderId: o.orderId }); approveUrl = o.approveUrl; }
    catch (e) { db.plat_payments.update(pay.id, { status: 'failed', failReason: e.message }); throw e; }
  }
  if (simu) P.completeFeePayment(pay.id, { providerRef: 'SIMPP' + sec.randomToken(6).toUpperCase().replace(/[-_]/g, 'X') });
  D.audit(ctx, 'billing.fee_initiated', 'plat_payment', pay.id, { method: 'paypal', usd, simulated: simu });
  return { payment: payView(db.plat_payments.get(pay.id)), approveUrl, usd };
});
H.route('POST', '/api/billing/pay/bank', { perm: 'billing.read', roles: ['landlord'], rate: [8, 60000] }, async (ctx) => {
  const b = clean(ctx.body, { invoiceId: { t: 'id', req: true }, bankRef: { t: 's', req: true, min: 4, max: 40, re: /^[A-Za-z0-9\-_/ ]+$/, label: 'Bank reference' } });
  const inv = pickInvoice(ctx, b.invoiceId);
  if (db.plat_payments.all().some((p) => p.bankRef && p.bankRef.toUpperCase() === b.bankRef.toUpperCase() && p.status !== 'failed')) throw E.conflict('That bank reference was already submitted.');
  const { pay } = newFeePayment(ctx, inv, 'bank', { bankRef: b.bankRef, status: 'awaiting_confirmation' });
  for (const a of db.users.where('role', 'national_admin')) D.notify(a.id, 'Bank fee payment to confirm', `${ctx.user.name} paid ${D.fmtMoney(pay.amount)} (ref ${b.bankRef}) for ${inv.invoiceNo}.`, 'admin', '#/admin/revenue');
  D.audit(ctx, 'billing.bank_submitted', 'plat_payment', pay.id, { ref: b.bankRef });
  return { payment: payView(pay), message: 'Thank you. It will show as paid once National Administration confirms it on the bank statement.' };
});
H.route('GET', '/api/billing/status/:id', { perm: 'billing.read', roles: ['landlord'] }, async (ctx) => {
  let p = db.plat_payments.get(ctx.params.id); if (!p || p.ownerId !== ctx.scope.ownerId) throw E.notFound();
  const po = P.config().payout;
  if (p.status === 'pending') {
    const age = Date.now() - p.createdAt;
    if (p.simulated && p.method === 'mpesa' && age > 4000) p = P.completeFeePayment(p.id, { providerRef: 'SIM' + sec.randomToken(7).toUpperCase().replace(/[-_]/g, 'X') });
    else if (!p.simulated && p.method === 'mpesa' && p.checkoutRequestId && age > 20000 && Date.now() - (p.lastQueryAt || 0) > 8000) {
      db.plat_payments.update(p.id, { lastQueryAt: Date.now() });
      try { const q = await gw.mpesaStkQuery(po.mpesa, p.checkoutRequestId); if (q.final) p = q.code === 0 ? P.completeFeePayment(p.id, { providerRef: 'CHK:' + p.checkoutRequestId }) : db.plat_payments.update(p.id, { status: 'failed', failReason: q.desc || 'Not approved' }); } catch { /* try again later */ }
    }
  }
  return { payment: payView(p) };
});
H.route('POST', '/api/billing/mpesa/callback/:token', { public: true, noCsrf: true, rate: [120, 60000] }, async (ctx) => {
  const ok = { ResultCode: 0, ResultDesc: 'Accepted' }; const cb = gw.parseMpesaCallback(ctx.body);
  const p = db.plat_payments.find('tokenHash', sec.sha256(String(ctx.params.token).slice(0, 80)));
  if (!cb || !p || p.method !== 'mpesa' || p.checkoutRequestId !== cb.checkoutRequestId) { S.audit.append({ action: 'security.bad_callback', ip: ctx.ip, detail: { scope: 'billing' } }); return ok; }
  try {
    if (cb.code === 0) {
      if (cb.amount !== undefined && Math.abs(cb.amount - p.amount) > 0.5) { db.plat_payments.update(p.id, { status: 'awaiting_confirmation', providerRef: cb.receipt, note: `Amount differs: expected ${p.amount}, got ${cb.amount}` }); }
      else P.completeFeePayment(p.id, { providerRef: cb.receipt });
    } else if (p.status === 'pending') db.plat_payments.update(p.id, { status: 'failed', failReason: cb.desc || 'Not approved' });
  } catch (e) { log('error', 'billing callback failed: ' + e.message); }
  return ok;
});
async function finishFeePaypal(pid, orderId) {
  const p = db.plat_payments.get(pid);
  if (!p || p.method !== 'paypal' || p.simulated || p.paypalOrderId !== orderId) return false;
  if (p.status === 'completed') return true;
  const cap = await gw.paypalCapture(P.config().payout.paypal, orderId);
  if (!cap.ok || cap.customId !== p.id) { db.plat_payments.update(p.id, { status: 'failed', failReason: 'PayPal did not complete the payment' }); return false; }
  if (cap.currency !== 'USD' || Math.abs(cap.usd - p.usd) > 0.01) { db.plat_payments.update(p.id, { status: 'awaiting_confirmation', providerRef: cap.captureId, note: 'Amount differs' }); return true; }
  P.completeFeePayment(p.id, { providerRef: cap.captureId }); return true;
}
H.route('GET', '/api/billing/paypal/return', { public: true, noCsrf: true, rate: [30, 60000] }, async (ctx) => {
  let ok = false; try { ok = await finishFeePaypal(String(ctx.query.pid || ''), String(ctx.query.token || '')); } catch (e) { log('error', 'fee paypal return: ' + e.message); }
  ctx.redirect(`/#/billing?paid=${ok ? 1 : 0}`);
});
H.route('GET', '/api/billing/paypal/cancel', { public: true, noCsrf: true, rate: [30, 60000] }, async (ctx) => {
  const p = db.plat_payments.get(String(ctx.query.pid || '')); if (p && p.status === 'pending' && p.method === 'paypal') db.plat_payments.update(p.id, { status: 'failed', failReason: 'Cancelled' });
  ctx.redirect('/#/billing?paid=0');
});

/* ============ National Administrator: pricing, revenue, per-landlord terms ============ */
function payoutView(po) {
  return { mode: po.mode, usdRate: po.usdRate,
    mpesa: { enabled: po.mpesa.enabled, env: po.mpesa.env, type: po.mpesa.type, shortcode: po.mpesa.shortcode, partyB: po.mpesa.partyB, consumerKey: po.mpesa.consumerKeyEnc ? MASK : '', consumerSecret: po.mpesa.consumerSecretEnc ? MASK : '', passkey: po.mpesa.passkeyEnc ? MASK : '' },
    paypal: { enabled: po.paypal.enabled, mode: po.paypal.mode, clientId: po.paypal.clientIdEnc ? MASK : '', secret: po.paypal.secretEnc ? MASK : '' },
    bank: po.bank, sms: { enabled: po.sms.enabled, username: po.sms.username, senderId: po.sms.senderId, apiKey: po.sms.apiKeyEnc ? MASK : '' } };
}
H.route('GET', '/api/admin/pricing/view', { perm: 'platform.finance' }, async (ctx) => {
  const c = P.config();
  return { pricing: c.pricing, trialDays: c.trialDays, dueDays: c.dueDays, graceDays: c.graceDays, holdOnNonPayment: c.holdOnNonPayment, payout: payoutView(c.payout), history: S.meta.get('platform:priceHistory', []).slice(0, 10), canEdit: !!ctx.user.isSuper, publicUrlReady: /^https:\/\//.test(D.publicUrl()) };
});
H.route('PUT', '/api/admin/pricing', { perm: 'platform.finance' }, async (ctx) => {
  needSuper(ctx);
  const b = ctx.body || {};
  const pr = clean(b.pricing || {}, { percentOfRent: { t: 'n', min: 0, max: 20, def: 0 }, minMonthly: { t: 'n', min: 0, max: 1e6, def: 0 }, countVacant: { t: 'b', def: true }, vatPercent: { t: 'n', min: 0, max: 30, def: 0 } });
  const tiers = Array.isArray((b.pricing || {}).tiers) ? b.pricing.tiers : null;
  if (!tiers || !tiers.length || tiers.length > 8) throw E.bad('Add between 1 and 8 price bands.');
  let last = 0; const clean_t = tiers.map((t, i) => {
    const fee = Number(t.fee); const up = t.upTo === null || t.upTo === '' || t.upTo === undefined ? null : Number(t.upTo);
    if (!Number.isFinite(fee) || fee < 0 || fee > 100000) throw E.bad('Each band needs a fee between 0 and 100,000.');
    if (up !== null && (!Number.isInteger(up) || up <= last)) throw E.bad('Band limits must be whole numbers that increase (e.g. 5, 50).');
    if (up === null && i !== tiers.length - 1) throw E.bad('Only the last band can have no upper limit.');
    if (up !== null) last = up; return { upTo: up, fee };
  });
  if (clean_t[clean_t.length - 1].upTo !== null) throw E.bad('The last band must have no upper limit ("and above").');
  const g = clean(b, { trialDays: { t: 'n', int: true, min: 0, max: 365, def: 60 }, dueDays: { t: 'n', int: true, min: 0, max: 60, def: 7 }, graceDays: { t: 'n', int: true, min: 0, max: 120, def: 14 }, holdOnNonPayment: { t: 'b', def: true } });
  const cur = P.config();
  P.saveConfig({ ...S.meta.get('platform:config', {}), pricing: { ...cur.pricing, ...pr, tiers: clean_t }, ...g }, ctx, 'pricing');
  D.audit(ctx, 'admin.pricing_changed', 'platform', null, { tiers: clean_t, ...pr, ...g });
  return { ok: true, note: 'New prices apply from the next monthly invoice. Invoices already issued keep their old price.' };
});
H.route('POST', '/api/admin/pricing/preview', { perm: 'platform.finance' }, async (ctx) => {
  const b = clean(ctx.body, { units: { t: 'n', int: true, min: 0, max: 100000, req: true }, rentPerUnit: { t: 'n', min: 0, max: 1e7, def: 0 } });
  const cur = P.config(); const pr = { ...cur.pricing };
  const tiers = Array.isArray(ctx.body.tiers) ? ctx.body.tiers.map((t) => ({ upTo: t.upTo === null || t.upTo === '' || t.upTo === undefined ? null : Number(t.upTo), fee: Number(t.fee) || 0 })) : pr.tiers;
  const t = P.tierFee(b.units, tiers); const pct = P.r2((pr.percentOfRent / 100) * b.units * (b.rentPerUnit || 0));
  let sub = t.total + pct; if (sub > 0 && pr.minMonthly && sub < pr.minMonthly) sub = pr.minMonthly;
  return { lines: t.lines, percentFee: pct, total: P.r2(sub * (1 + pr.vatPercent / 100)), perUnit: b.units ? P.r2(sub / b.units) : 0 };
});
H.route('PUT', '/api/admin/payout', { perm: 'platform.finance', rate: [10, 60000] }, async (ctx) => {
  needSuper(ctx);
  const b = ctx.body || {};
  if (!(await sec.verifyPassword(String(b.password || ''), ctx.user.passHash))) throw E.bad('Your password is not correct. It is needed to change where the money goes.');
  const g = clean(b, { mode: { t: 'e', values: ['simulate', 'live'], req: true }, usdRate: { t: 'n', min: 1, max: 1000, def: 129 } });
  const m = clean(b.mpesa || {}, { enabled: { t: 'b' }, env: { t: 'e', values: ['sandbox', 'production'], def: 'sandbox' }, type: { t: 'e', values: ['paybill', 'till'], def: 'paybill' }, shortcode: { t: 's', max: 12, re: /^\d*$/ }, partyB: { t: 's', max: 12, re: /^\d*$/ }, consumerKey: { t: 's', max: 200, raw: true }, consumerSecret: { t: 's', max: 200, raw: true }, passkey: { t: 's', max: 300, raw: true } });
  const p = clean(b.paypal || {}, { enabled: { t: 'b' }, mode: { t: 'e', values: ['sandbox', 'live'], def: 'sandbox' }, clientId: { t: 's', max: 200, raw: true }, secret: { t: 's', max: 300, raw: true } });
  const k = clean(b.bank || {}, { enabled: { t: 'b' }, bankName: { t: 's', max: 80 }, accountName: { t: 's', max: 100 }, accountNo: { t: 's', max: 40 }, branch: { t: 's', max: 80 }, instructions: { t: 's', max: 400 } });
  const sm = clean(b.sms || {}, { enabled: { t: 'b' }, username: { t: 's', max: 60 }, senderId: { t: 's', max: 11 }, apiKey: { t: 's', max: 200, raw: true } });
  if (g.mode === 'live' && !/^https:\/\//.test(D.publicUrl())) throw E.bad('Live mode needs the public https address (System page) so M-Pesa and PayPal can confirm payments.');
  const secret = (v, old) => (v === undefined || v === '' || v === MASK ? old : sec.encField(v));
  const po = P.config().payout;
  const next = { mode: g.mode, usdRate: g.usdRate,
    mpesa: { enabled: !!m.enabled, env: m.env, type: m.type, shortcode: m.shortcode || '', partyB: m.partyB || '', consumerKeyEnc: secret(m.consumerKey, po.mpesa.consumerKeyEnc), consumerSecretEnc: secret(m.consumerSecret, po.mpesa.consumerSecretEnc), passkeyEnc: secret(m.passkey, po.mpesa.passkeyEnc) },
    paypal: { enabled: !!p.enabled, mode: p.mode, clientIdEnc: secret(p.clientId, po.paypal.clientIdEnc), secretEnc: secret(p.secret, po.paypal.secretEnc) },
    bank: { enabled: !!k.enabled, bankName: k.bankName || '', accountName: k.accountName || '', accountNo: k.accountNo || '', branch: k.branch || '', instructions: k.instructions || '' },
    sms: { enabled: !!sm.enabled, username: sm.username || '', senderId: sm.senderId || '', apiKeyEnc: secret(sm.apiKey, po.sms.apiKeyEnc) } };
  P.saveConfig({ ...S.meta.get('platform:config', {}), payout: next }, ctx, 'payout');
  D.audit(ctx, 'admin.payout_changed', 'platform', null, { mode: g.mode, mpesa: !!m.enabled, paypal: !!p.enabled, bank: !!k.enabled, shortcode: m.shortcode || '', bankAccount: k.accountNo ? '…' + String(k.accountNo).slice(-4) : '' });
  return { payout: payoutView(next) };
});
H.route('POST', '/api/admin/payout/test', { perm: 'platform.finance', rate: [6, 60000] }, async (ctx) => {
  needSuper(ctx); const po = P.config().payout; const out = {};
  if (gw.mpesaReady({ ...po.mpesa, enabled: true })) { try { await gw.mpesaToken(po.mpesa); out.mpesa = 'Connected'; } catch (e) { out.mpesa = e.message; } } else out.mpesa = 'Not set up';
  if (gw.paypalReady({ ...po.paypal, enabled: true })) { try { await gw.ppToken(po.paypal); out.paypal = 'Connected'; } catch (e) { out.paypal = e.message; } } else out.paypal = 'Not set up';
  return out;
});

H.route('GET', '/api/admin/billing', { perm: 'platform.finance' }, async () => {
  const names = new Map(db.users.where('role', 'landlord').map((l) => [l.id, l]));
  const invs = db.plat_invoices.all().sort((a, b) => b.createdAt - a.createdAt).slice(0, 300).map((i) => ({ ...feeInvView(i), ownerId: i.ownerId, landlord: (names.get(i.ownerId) || {}).name || '', company: (names.get(i.ownerId) || {}).company || '' }));
  const pending = db.plat_payments.where('status', 'awaiting_confirmation').map((p) => ({ ...payView(p), bankRef: p.bankRef, note: p.note || '', landlord: (names.get(p.ownerId) || {}).name || '', invoiceNo: (db.plat_invoices.get(p.invoiceId) || {}).invoiceNo }));
  const rows = [...names.values()].map((l) => ({ id: l.id, name: l.name, company: l.company || '', status: l.status, trial: P.inTrial(l), trialUntil: P.trialEnd(l), units: P.ownerUnits(l.id).length, monthly: P.quoteFor(l.id).total, owing: Math.round(P.owing(l.id).reduce((a, i) => a + i.amount - i.paid, 0) * 100) / 100, onHold: P.onHold(l.id), billing: l.billing || {} })).sort((a, b) => b.units - a.units);
  return { summary: P.revenue(), invoices: invs, pending, landlords: rows };
});
H.route('POST', '/api/admin/billing/generate', { perm: 'platform.finance', rate: [6, 60000] }, async (ctx) => { const n = P.generateInvoices(); D.audit(ctx, 'admin.invoices_generated', 'platform', null, { n }); return { created: n }; });
H.route('POST', '/api/admin/billing/payments/:id/confirm', { perm: 'platform.finance' }, async (ctx) => {
  const b = clean(ctx.body, { accept: { t: 'b', req: true } });
  const p = db.plat_payments.get(ctx.params.id); if (!p || p.status !== 'awaiting_confirmation') throw E.notFound();
  if (b.accept) P.completeFeePayment(p.id, { by: ctx.user.id }); else { db.plat_payments.update(p.id, { status: 'failed', failReason: 'Rejected by National Administration' }); D.notify(p.ownerId, 'Fee payment not accepted', 'Your bank payment could not be matched. Please check the reference and resubmit.', 'billing', '#/billing'); }
  D.audit(ctx, b.accept ? 'admin.fee_payment_confirmed' : 'admin.fee_payment_rejected', 'plat_payment', p.id, { amount: p.amount });
  return { ok: true };
});
H.route('POST', '/api/admin/billing/invoices/:id/record', { perm: 'platform.finance' }, async (ctx) => {
  const b = clean(ctx.body, { method: { t: 'e', values: ['cash', 'bank', 'mpesa', 'cheque'], req: true }, reference: { t: 's', max: 40 } });
  const i = db.plat_invoices.get(ctx.params.id); if (!i || i.status !== 'open') throw E.notFound();
  const pay = db.plat_payments.insert({ ownerId: i.ownerId, invoiceId: i.id, amount: Math.round((i.amount - i.paid) * 100) / 100, method: b.method, status: 'pending', providerRef: b.reference || undefined, recordedBy: ctx.user.id });
  P.completeFeePayment(pay.id, { by: ctx.user.id }); D.audit(ctx, 'admin.fee_recorded', 'plat_invoice', i.id, { method: b.method });
  return { ok: true };
});
H.route('POST', '/api/admin/billing/invoices/:id/waive', { perm: 'platform.finance' }, async (ctx) => {
  needSuper(ctx); const i = db.plat_invoices.get(ctx.params.id); if (!i || i.status !== 'open') throw E.notFound();
  db.plat_invoices.update(i.id, { status: 'waived', waivedBy: ctx.user.id, waivedAt: Date.now() });
  D.notify(i.ownerId, 'Platform fee waived', `${i.desc} has been waived.`, 'billing', '#/billing'); D.audit(ctx, 'admin.fee_waived', 'plat_invoice', i.id, { amount: i.amount });
  return { ok: true };
});
H.route('PUT', '/api/admin/landlords/:id/billing', { perm: 'platform.finance' }, async (ctx) => {
  needSuper(ctx);
  const b = clean(ctx.body, { waived: { t: 'b' }, discountPct: { t: 'n', min: 0, max: 100, def: 0 }, perUnitOverride: { t: 'n', min: 0, max: 100000 }, trialUntil: { t: 'd' }, note: { t: 's', max: 200 } });
  const u = db.users.get(ctx.params.id); if (!u || u.role !== 'landlord') throw E.notFound();
  db.users.update(u.id, { billing: { waived: !!b.waived, discountPct: b.discountPct || 0, perUnitOverride: b.perUnitOverride === undefined ? null : b.perUnitOverride, trialUntil: b.trialUntil ? Date.parse(b.trialUntil + 'T23:59:59Z') : undefined, note: b.note || '' } });
  D.audit(ctx, 'admin.landlord_billing_terms', 'user', u.id, { waived: !!b.waived, discountPct: b.discountPct || 0, perUnitOverride: b.perUnitOverride ?? null });
  return { ok: true };
});

/* ============ platform-wide settings (announcements, registration, maintenance, phone-change policy) ============ */
H.route('GET', '/api/admin/platform', { perm: 'platform.settings' }, async () => { const c = P.config(); return { registration: c.registration, listingsPublic: c.listingsPublic, maintenanceMode: c.maintenanceMode, maintenanceNote: c.maintenanceNote, announcement: c.announcement, support: c.support, phoneChange: c.phoneChange, defaults: c.defaults }; });
H.route('PUT', '/api/admin/platform', { perm: 'platform.settings' }, async (ctx) => {
  const b = clean(ctx.body, { registration: { t: 'e', values: ['approval', 'open', 'closed'], req: true }, listingsPublic: { t: 'b', def: true }, maintenanceMode: { t: 'b', def: false }, maintenanceNote: { t: 's', max: 200 }, phoneChange: { t: 'e', values: ['otp', 'approval', 'staff_only'], req: true } });
  const a = clean(ctx.body.announcement || {}, { active: { t: 'b' }, text: { t: 's', max: 300 }, level: { t: 'e', values: ['info', 'warn', 'bad'], def: 'info' } });
  const su = clean(ctx.body.support || {}, { phone: { t: 's', max: 30 }, email: { t: 's', max: 100 }, whatsapp: { t: 's', max: 30 } });
  const d = clean(ctx.body.defaults || {}, { reminderDays: { t: 'n', int: true, min: 0, max: 14, def: 3 }, usdRate: { t: 'n', min: 1, max: 1000, def: 129 } });
  P.saveConfig({ ...S.meta.get('platform:config', {}), ...b, announcement: { active: !!a.active, text: a.text || '', level: a.level }, support: su, defaults: d }, ctx, 'platform');
  D.audit(ctx, 'admin.platform_settings', 'platform', null, { ...b, announcement: !!a.active, maintenance: b.maintenanceMode });
  return { ok: true };
});

/* ============ rules packs, tax rules and integration health ============ */
async function probe() {
  const out = []; const t0 = Date.now();
  for (const [name, url] of [['Safaricom Daraja (sandbox)', rules.get('integrations.mpesa.sandbox')], ['PayPal (sandbox)', rules.get('integrations.paypal.sandbox')], ['KRA eTIMS (sandbox)', rules.get('integrations.etims.sandbox')]]) {
    try { await fetch(url, { method: 'GET', signal: AbortSignal.timeout(8000) }); out.push({ name, url, ok: true }); } catch (e) { out.push({ name, url, ok: false, error: String(e.cause && e.cause.code || e.message) }); }
  }
  const r = { at: Date.now(), ms: Date.now() - t0, results: out }; S.meta.set('integrations:health', r); return r;
}
H.route('GET', '/api/admin/rules', { perm: 'platform.rules' }, async (ctx) => ({
  version: rules.all().version, issuedAt: rules.all().issuedAt, notes: rules.all().notes, tax: rules.all().tax, integrations: rules.all().integrations, history: S.meta.get('rules:history', []).map((h) => ({ version: h.version, at: h.at, by: h.by, signed: h.signed })),
  feed: S.meta.get('rules:feed', ''), feedStatus: S.meta.get('rules:feedStatus', null), pubkey: S.meta.get('rules:pubkey', ''), health: S.meta.get('integrations:health', null), canEdit: !!ctx.user.isSuper,
}));
H.route('PUT', '/api/admin/rules/source', { perm: 'platform.rules' }, async (ctx) => {
  needSuper(ctx);
  const b = clean(ctx.body, { feed: { t: 's', max: 300 }, pubkey: { t: 's', max: 200, re: /^[A-Za-z0-9+/=]*$/ } });
  if (b.feed && !/^https:\/\/[^\s]+$/.test(b.feed)) throw E.bad('The feed address must start with https://');
  S.meta.set('rules:feed', b.feed || ''); if (b.pubkey !== undefined) S.meta.set('rules:pubkey', b.pubkey || '');
  D.audit(ctx, 'admin.rules_source_set', 'platform', null, { feed: b.feed || '' });
  return { ok: true };
});
H.route('POST', '/api/admin/rules/import', { perm: 'platform.rules', rate: [10, 60000] }, async (ctx) => {
  needSuper(ctx);
  try { const r = rules.install(ctx.body && ctx.body.pack, { by: ctx.user.name, signed: true }); D.audit(ctx, 'admin.rules_imported', 'platform', null, { version: r.version }); return { version: r.version }; }
  catch (e) { throw E.bad(e.message); }
});
H.route('PUT', '/api/admin/rules/tax', { perm: 'platform.rules' }, async (ctx) => {
  // Direct edit by the super administrator for the day a rate changes and no signed pack exists yet.
  needSuper(ctx);
  const b = clean(ctx.body, { mriRate: { t: 'n', min: 0, max: 0.5, req: true }, mriAnnualMin: { t: 'n', min: 0, max: 1e8, req: true }, mriAnnualMax: { t: 'n', min: 0, max: 1e10, req: true }, vatRate: { t: 'n', min: 0, max: 0.5, req: true }, dueDay: { t: 'n', int: true, min: 1, max: 28, req: true }, note: { t: 's', max: 300, req: true, label: 'Reason / source (e.g. Finance Act 2026 s.12)' } });
  const cur = rules.all(); const ver = new Date().toISOString().slice(0, 10).replace(/-/g, '.') + '.m' + (S.meta.incr('rules:manual'));
  const data = { tax: { mri: { ...cur.tax.mri, rate: b.mriRate, annualMin: b.mriAnnualMin, annualMax: b.mriAnnualMax, dueDay: b.dueDay, pendingChange: b.note }, vat: { ...cur.tax.vat, standardRate: b.vatRate } } };
  const r = rules.install({ version: ver > String(cur.version) ? ver : cur.version + '.1', issuedAt: new Date().toISOString().slice(0, 10), data }, { by: ctx.user.name, signed: false });
  D.audit(ctx, 'admin.tax_rules_edited', 'platform', null, { ...b, version: r.version });
  return { version: r.version };
});
H.route('POST', '/api/admin/rules/rollback', { perm: 'platform.rules' }, async (ctx) => { needSuper(ctx); try { const r = rules.rollback(); D.audit(ctx, 'admin.rules_rollback', 'platform', null, { version: r.version }); return { version: r.version }; } catch (e) { throw E.bad(e.message); } });
H.route('POST', '/api/admin/rules/check', { perm: 'platform.rules', rate: [6, 60000] }, async () => ({ feed: await rules.checkFeed(), health: await probe() }));

module.exports = { probe };
