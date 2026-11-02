'use strict';
// PLATFORM BUSINESS: what the National Administrator earns per unit managed, billing of landlords, and platform-wide settings.
const S = require('./store');
const { db } = S;
const U = require('./util');
const { E, log } = U;
const D = require('./domain');

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const DEFAULTS = {
  pricing: {
    // Graduated price per unit per month: units up to `upTo` cost `fee` each. upTo:null = everything above.
    tiers: [{ upTo: 5, fee: 0 }, { upTo: 50, fee: 40 }, { upTo: null, fee: 25 }],
    percentOfRent: 0,      // optional extra: % of the monthly rent of occupied units (0 = off)
    minMonthly: 0,         // minimum monthly fee once the free allowance is exceeded (0 = none)
    countVacant: true,     // bill vacant units too ("units managed")
    vatPercent: 0,         // add VAT to the platform fee if you are VAT-registered (e.g. 16)
  },
  trialDays: 60, dueDays: 7, graceDays: 14, holdOnNonPayment: true,
  registration: 'approval', // approval | open | closed
  listingsPublic: true, maintenanceMode: false, maintenanceNote: 'The system is being updated. Please try again shortly.',
  announcement: { active: false, text: '', level: 'info' },
  support: { phone: '', email: '', whatsapp: '' },
  // Data-controller details shown in the Terms and Privacy Notice (Data Protection Act, 2019). Fill these in under Admin > Privacy & legal.
  legal: { controllerName: 'Jasmyle Properties', address: '', town: 'Nairobi, Kenya', email: '', phone: '', dpoName: '', dpoEmail: '', odpcRegNo: '', kraPin: '' },
  phoneChange: 'otp',       // otp | approval | staff_only
  defaults: { reminderDays: 3, usdRate: 129 },
  payout: {
    mode: 'simulate', usdRate: 129,
    mpesa: { enabled: false, env: 'sandbox', type: 'paybill', shortcode: '', partyB: '', consumerKeyEnc: '', consumerSecretEnc: '', passkeyEnc: '' },
    paypal: { enabled: false, mode: 'sandbox', clientIdEnc: '', secretEnc: '' },
    bank: { enabled: true, bankName: '', accountName: '', accountNo: '', branch: '', instructions: '' },
    sms: { enabled: false, username: '', apiKeyEnc: '', senderId: '' },
  },
};
const merge = (a, b) => { const o = { ...a }; for (const k of Object.keys(b || {})) { if (k === '__proto__') continue; o[k] = a && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) && b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) ? merge(a[k], b[k]) : b[k]; } return o; };
let cfgCache = null;
function config() { if (!cfgCache) cfgCache = merge(DEFAULTS, S.meta.get('platform:config', {})); return cfgCache; }
function saveConfig(next, ctx, what) {
  const old = config();
  S.meta.set('platform:config', next); cfgCache = null;
  if (what === 'pricing') {
    const hist = S.meta.get('platform:priceHistory', []);
    hist.unshift({ at: Date.now(), by: ctx.user.id, byName: ctx.user.name, from: old.pricing, to: next.pricing });
    S.meta.set('platform:priceHistory', hist.slice(0, 50));
  }
}
const publicConfig = () => { const c = config(); return { registration: c.registration, listingsPublic: c.listingsPublic, announcement: c.announcement.active ? c.announcement : null, support: c.support, maintenance: c.maintenanceMode, legal: { controllerName: c.legal.controllerName, email: c.legal.email, phone: c.legal.phone, dpoEmail: c.legal.dpoEmail } }; };

/* ---------- fee calculation ---------- */
function ownerUnits(ownerId) {
  const props = new Set(db.properties.byOwner(ownerId).filter((p) => p.status !== 'archived').map((p) => p.id));
  return db.units.byOwner(ownerId).filter((u) => !u.archived && props.has(u.propertyId));
}
function tierFee(n, tiers, override) {
  const lines = []; let prev = 0, total = 0;
  for (const t of tiers) {
    const top = t.upTo === null || t.upTo === undefined ? Infinity : t.upTo;
    const count = Math.max(0, Math.min(n, top) - prev);
    if (count > 0) { const fee = override !== null && override !== undefined && t.fee > 0 ? override : t.fee; lines.push({ from: prev + 1, to: prev + count, units: count, fee, amount: r2(count * fee) }); total += count * fee; }
    prev = top; if (n <= top) break;
  }
  return { lines, total: r2(total) };
}
function quote(ownerId, units, rentSum) {
  const c = config().pricing; const o = db.users.get(ownerId); const b = (o && o.billing) || {};
  if (b.waived) return { units, lines: [], unitFee: 0, percentFee: 0, discount: 0, subtotal: 0, vat: 0, total: 0, waived: true };
  const t = tierFee(units, c.tiers, b.perUnitOverride);
  const pct = r2(((c.percentOfRent || 0) / 100) * rentSum);
  let sub = t.total + pct;
  if (sub > 0 && c.minMonthly && sub < c.minMonthly) sub = c.minMonthly;
  const disc = r2(sub * ((b.discountPct || 0) / 100));
  const net = r2(sub - disc); const vat = r2(net * ((c.vatPercent || 0) / 100));
  return { units, lines: t.lines, unitFee: t.total, percentFee: pct, minApplied: sub !== t.total + pct, discount: disc, subtotal: net, vat, total: r2(net + vat) };
}
function quoteFor(ownerId) {
  const c = config().pricing; const us = ownerUnits(ownerId);
  const billed = c.countVacant ? us : us.filter((u) => u.status === 'occupied');
  const rentSum = db.leases.byOwner(ownerId).filter((l) => l.status === 'active').reduce((a, l) => a + (l.rent || 0), 0);
  return quote(ownerId, billed.length, rentSum);
}

/* ---------- trial & invoices ---------- */
const trialEnd = (o) => (o.billing && o.billing.trialUntil) || ((o.approvedAt || o.createdAt) + config().trialDays * 86400e3);
const inTrial = (o) => Date.now() < trialEnd(o);
function generateInvoices(today = U.todayStr()) {
  const period = U.monthOf(today); let n = 0;
  for (const o of db.users.where('role', 'landlord')) {
    if (o.status !== 'active' || inTrial(o)) continue;
    if (db.plat_invoices.byOwner(o.id).some((i) => i.period === period)) continue;
    const q = quoteFor(o.id);
    if (q.total <= 0) continue;
    const due = new Date(Date.parse(today + 'T00:00:00Z') + config().dueDays * 86400e3).toISOString().slice(0, 10);
    try {
      const seq = S.meta.incr('platinv:seq');
      db.plat_invoices.insert({ ownerId: o.id, period, invoiceNo: 'PF-' + String(seq).padStart(6, '0'), desc: `Platform fee ${period} (${q.units} units)`, quote: q, amount: q.total, paid: 0, status: 'open', issued: today, dueDate: due });
      D.notify(o.id, 'Platform fee invoice', `Your Jasmyle Properties fee for ${period} is ${D.fmtMoney(q.total)} (${q.units} units). Due ${due}.`, 'billing', '#/billing');
      n++;
    } catch (e) { if (e.code !== 'duplicate') log('error', 'platform invoice failed: ' + e.message); }
  }
  return n;
}
const owing = (ownerId) => db.plat_invoices.byOwner(ownerId).filter((i) => i.status === 'open' && i.amount - i.paid > 0.004);
function onHold(ownerId, today = U.todayStr()) {
  const c = config(); if (!c.holdOnNonPayment) return false;
  return owing(ownerId).some((i) => U.daysBetween(i.dueDate, today) > c.graceDays);
}
/** Blocks growth (new properties/units/tenants) while a fee is badly overdue. Rent collection from tenants is NEVER blocked. */
function assertCanGrow(ownerId) {
  if (onHold(ownerId)) throw E.conflict('Your Jasmyle Properties platform fee is overdue, so adding new properties, units and tenants is paused. Rent collection and everything else keeps working. Please pay the fee under "Platform fee".', 'billing_hold');
}
function dunning(today = U.todayStr()) {
  let n = 0;
  for (const o of db.users.where('role', 'landlord')) {
    if (o.status !== 'active') continue;
    for (const i of owing(o.id)) {
      const late = U.daysBetween(i.dueDate, today);
      if (late > 0 && (!i.lastReminder || U.daysBetween(i.lastReminder, today) >= 7)) {
        D.notify(o.id, 'Platform fee overdue', `${i.desc} (${D.fmtMoney(i.amount - i.paid)}) is ${late} day(s) overdue.${config().holdOnNonPayment ? ` New properties and tenants are paused after ${config().graceDays} days.` : ''}`, 'billing', '#/billing');
        db.plat_invoices.update(i.id, { lastReminder: today }); n++;
      }
    }
  }
  return n;
}

/* ---------- payment completion (idempotent) ---------- */
function completeFeePayment(payId, { providerRef, by } = {}) {
  return S.tx(() => {
    const p = db.plat_payments.get(payId);
    if (!p) throw E.notFound();
    if (p.status === 'completed') return p;
    const inv = db.plat_invoices.get(p.invoiceId);
    const done = db.plat_payments.update(p.id, { status: 'completed', paidAt: Date.now(), providerRef: providerRef || p.providerRef, confirmedBy: by || null, failReason: null });
    if (inv) {
      const paid = r2(inv.paid + p.amount);
      db.plat_invoices.update(inv.id, { paid, status: paid + 0.004 >= inv.amount ? 'paid' : 'open', paidAt: paid + 0.004 >= inv.amount ? Date.now() : undefined });
    }
    D.notify(p.ownerId, 'Platform fee received', `Thank you. ${D.fmtMoney(p.amount)} received for ${inv ? inv.desc : 'platform fee'}.`, 'billing', '#/billing');
    S.audit.append({ owner: p.ownerId, actor: by || p.ownerId, role: by ? 'national_admin' : 'landlord', action: 'billing.fee_paid', entity: 'plat_payment', entityId: p.id, detail: { amount: p.amount, method: p.method } });
    return done;
  });
}

/* ---------- revenue summary for the administrator ---------- */
function revenue() {
  const invs = db.plat_invoices.all(); const today = U.todayStr();
  const sum = (a, f) => r2(a.reduce((x, y) => x + f(y), 0));
  const landlords = db.users.where('role', 'landlord');
  const est = landlords.filter((l) => l.status === 'active' && !inTrial(l)).reduce((a, l) => a + quoteFor(l.id).total, 0);
  const months = U.lastMonths(6, U.monthOf(today) + '-01');
  return {
    billed: sum(invs, (i) => i.amount), collected: sum(invs, (i) => i.paid), outstanding: sum(invs.filter((i) => i.status === 'open'), (i) => i.amount - i.paid),
    overdue: sum(invs.filter((i) => i.status === 'open' && i.dueDate < today), (i) => i.amount - i.paid),
    monthlyRecurringEstimate: r2(est), unitsManaged: landlords.reduce((a, l) => a + ownerUnits(l.id).length, 0),
    inTrial: landlords.filter((l) => l.status === 'active' && inTrial(l)).length,
    trend: months.map((m) => ({ month: m, billed: sum(invs.filter((i) => i.period === m), (i) => i.amount), collected: sum(db.plat_payments.all().filter((p) => p.status === 'completed' && U.dateOf(p.paidAt).slice(0, 7) === m), (p) => p.amount) })),
  };
}

module.exports = { config, saveConfig, publicConfig, DEFAULTS, merge, quote, quoteFor, tierFee, ownerUnits, trialEnd, inTrial, generateInvoices, owing, onHold, assertCanGrow, dunning, completeFeePayment, revenue, r2 };
