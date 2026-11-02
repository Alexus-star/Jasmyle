'use strict';
// Water and electricity: tariffs per property, monthly meter readings per unit, and one invoice per reading.
// Caretakers can record readings (no money visible); landlords and managers turn readings into bills.
// Only the landlord can change the rates (same permission as changing rent).
const S = require('../store');
const { db } = S;
const U = require('../util');
const { E, clean } = U;
const R = require('../roles');
const H = require('../http');
const D = require('../domain');

const UTILITIES = { water: { label: 'Water', unit: 'm³' }, electricity: { label: 'Electricity', unit: 'kWh' } };
const UTIL_KEYS = Object.keys(UTILITIES);
const CAN_MONEY = (ctx) => R.can(ctx.user, 'rent.charge');

/* ---------- tariffs (stored on the property) ---------- */
function tariffOf(prop, utility) {
  const t = (prop.tariffs && prop.tariffs[utility]) || {};
  return {
    enabled: !!t.enabled, rate: Number(t.rate) || 0, fixed: Number(t.fixed) || 0, dueDays: Number.isInteger(t.dueDays) ? t.dueDays : 7,
    label: t.label || UTILITIES[utility].label, unit: UTILITIES[utility].unit,
  };
}
const allTariffs = (prop) => Object.fromEntries(UTIL_KEYS.map((k) => [k, tariffOf(prop, k)]));
const money = (ctx, t) => (CAN_MONEY(ctx) ? t : { ...t, rate: undefined, fixed: undefined });

H.route('PUT', '/api/properties/:id/tariffs', { perm: 'lease.rent' }, async (ctx) => {
  const p = D.getProperty(ctx.params.id, ctx);
  const one = { enabled: { t: 'b', def: false }, rate: { t: 'n', max: 100000, def: 0 }, fixed: { t: 'n', max: 1e6, def: 0 }, dueDays: { t: 'n', int: true, min: 1, max: 60, def: 7 }, label: { t: 's', max: 30 } };
  const body = ctx.body || {};
  const tariffs = { ...(p.tariffs || {}) };
  for (const k of UTIL_KEYS) {
    if (body[k] === undefined) continue;
    const t = clean(body[k], one);
    if (t.enabled && !(t.rate > 0 || t.fixed > 0)) throw E.bad(`${UTILITIES[k].label}: enter a rate per ${UTILITIES[k].unit} (or a fixed monthly charge) before switching it on`, 'validation');
    tariffs[k] = t;
  }
  const up = db.properties.update(p.id, { tariffs });
  D.audit(ctx, 'utility.tariffs_changed', 'property', p.id, { tariffs: Object.fromEntries(UTIL_KEYS.map((k) => [k, tariffOf(up, k)])) });
  return { tariffs: allTariffs(up) };
});

/* ---------- helpers ---------- */
const live = (r) => !r.void; // voided readings stay for the record but do not count
function readingBilled(r) {
  if (!r.invoiceId) return false;
  const inv = db.invoices.get(r.invoiceId);
  return !!inv && inv.status !== 'void';
}
/** the latest reading before `period` (its "current" is this month's "previous") */
function lastBefore(unitId, utility, period) {
  return db.readings.where('unitId', unitId).filter((r) => live(r) && r.utility === utility && r.period < period).sort((a, b) => b.period.localeCompare(a.period))[0] || null;
}
function recentUnits(unitId, utility, period, n = 3) {
  return db.readings.where('unitId', unitId).filter((r) => live(r) && r.utility === utility && r.period < period && r.units > 0).sort((a, b) => b.period.localeCompare(a.period)).slice(0, n).map((r) => r.units);
}
const periodField = { t: 'm', req: true, label: 'Month' };
const utilField = { t: 'e', values: UTIL_KEYS, req: true, label: 'Utility' };
function checkPeriod(period) {
  if (period > U.monthOf(U.todayStr())) throw E.bad('You cannot record readings for a future month');
  if (period < U.addMonths(U.monthOf(U.todayStr()), -24)) throw E.bad('That month is too far back');
}
const unitsOf = (cur, prev) => Math.round((cur - prev + Number.EPSILON) * 1000) / 1000;

function billReading(ctx, r, prop, tariff, dueDate) {
  const unit = db.units.get(r.unitId);
  const lease = unit && unit.leaseId ? db.leases.get(unit.leaseId) : null;
  if (!lease || lease.status !== 'active') throw E.conflict('This unit has no tenant to bill.');
  const amount = D.r2(r.units * tariff.rate + tariff.fixed);
  if (amount <= 0) return { amount: 0, invoice: null };
  const detail = tariff.rate > 0 ? `${r.previous} to ${r.current} = ${r.units} ${tariff.unit} x KES ${tariff.rate}` + (tariff.fixed ? ` + KES ${tariff.fixed} fixed` : '') : 'fixed monthly charge';
  const inv = D.createInvoice(lease, { type: 'utility', utility: r.utility, readingId: r.id, period: null, desc: `${tariff.label} ${r.period} (${detail})`.slice(0, 160), amount, dueDate: dueDate || U.addDays(U.todayStr(), tariff.dueDays) });
  if (!inv) throw E.conflict('Could not create the bill.');
  db.readings.update(r.id, { invoiceId: inv.id, amount, rate: tariff.rate, fixed: tariff.fixed, billedAt: Date.now(), billedBy: ctx.user.id });
  D.notify(lease.tenantId, `${tariff.label} bill`, `${tariff.label} for ${r.period}: ${D.fmtMoney(amount)} (${r.units} ${tariff.unit}).`, 'invoice', '#/home');
  D.audit(ctx, 'utility.billed', 'invoice', inv.id, { unit: unit.name, utility: r.utility, period: r.period, units: r.units, amount });
  return { amount, invoice: inv };
}

/* ---------- the monthly meter sheet ---------- */
H.route('GET', '/api/utilities/sheet', { perm: 'utility.read' }, async (ctx) => {
  const b = clean(ctx.query, { propertyId: { t: 'id', req: true }, utility: utilField, period: { t: 'm', def: U.monthOf(U.todayStr()) } });
  const prop = D.getProperty(b.propertyId, ctx);
  const tariff = tariffOf(prop, b.utility);
  const money_ = CAN_MONEY(ctx);
  const units = db.units.byProp(prop.id).filter((u) => !u.archived && u.status === 'occupied').sort((a, c) => a.name.localeCompare(c.name, undefined, { numeric: true }));
  const tenants = new Map(db.users.byOwner(prop.ownerId).filter((u) => u.role === 'tenant').map((u) => [u.id, u.name]));
  const rows = units.map((u) => {
    const cur = db.readings.where('unitId', u.id).find((r) => live(r) && r.utility === b.utility && r.period === b.period) || null;
    const prev = lastBefore(u.id, b.utility, b.period);
    const hist = recentUnits(u.id, b.utility, b.period);
    const avg = hist.length ? Math.round((hist.reduce((a, x) => a + x, 0) / hist.length) * 100) / 100 : null;
    return {
      unitId: u.id, unitName: u.name, tenantName: tenants.get(u.tenantId) || '',
      previous: cur ? cur.previous : prev ? prev.current : null, hasBaseline: !!(cur || prev), avgUnits: avg,
      reading: cur ? { id: cur.id, current: cur.current, units: cur.units, billed: readingBilled(cur), invoiceId: cur.invoiceId || null, amount: money_ ? cur.amount ?? null : undefined, note: cur.note || '' } : null,
    };
  });
  return { property: { id: prop.id, name: prop.name }, utility: b.utility, period: b.period, tariff: money(ctx, tariff), canBill: money_, canSetRates: R.can(ctx.user, 'lease.rent'), tariffs: Object.fromEntries(UTIL_KEYS.map((k) => [k, money(ctx, tariffOf(prop, k))])), rows };
});

/* ---------- save readings (and optionally bill them) ---------- */
H.route('POST', '/api/utilities/readings', { perm: 'utility.read', rate: [60, 60000], rawMax: 512 * 1024 }, async (ctx) => {
  const b = clean(ctx.body, { propertyId: { t: 'id', req: true }, utility: utilField, period: periodField, bill: { t: 'b', def: false }, dueDate: { t: 'd' } });
  if (!Array.isArray(ctx.body.readings) || !ctx.body.readings.length) throw E.bad('Enter at least one meter reading');
  if (ctx.body.readings.length > 500) throw E.bad('Too many readings at once (max 500)');
  checkPeriod(b.period);
  if (b.bill && !CAN_MONEY(ctx)) throw E.forbidden();
  const prop = D.getProperty(b.propertyId, ctx);
  const tariff = tariffOf(prop, b.utility);
  if (b.bill && !tariff.enabled) throw E.conflict(`${tariff.label} billing is not switched on for this property. Set the rate first.`);
  const results = [];
  for (const row of ctx.body.readings) {
    const res = { unitId: row && row.unitId, ok: false };
    results.push(res);
    try {
      const f = clean(row, { unitId: { t: 'id', req: true }, current: { t: 'n', req: true, max: 1e9, label: 'Reading' }, previous: { t: 'n', max: 1e9 }, reset: { t: 'b', def: false }, note: { t: 's', max: 120 } });
      const unit = D.getScoped(db.units, f.unitId, ctx);
      if (unit.propertyId !== prop.id) throw E.notFound();
      if (unit.status !== 'occupied') throw E.conflict('This unit has no tenant.');
      S.tx(() => {
        const existing = db.readings.where('unitId', unit.id).find((r) => live(r) && r.utility === b.utility && r.period === b.period) || null;
        if (existing && readingBilled(existing)) throw E.conflict('Already billed. Cancel that invoice first if the reading was wrong.');
        const prior = lastBefore(unit.id, b.utility, b.period);
        let previous;
        if (existing && existing.reset) previous = existing.previous;
        if (f.reset || (!prior && !existing)) { // first ever reading (opening) or replaced meter: the person tells us where it starts
          if (f.previous === undefined && f.reset) throw E.bad('For a replaced meter, enter the new meter\'s opening reading');
          previous = f.previous;
        }
        if (previous === undefined) previous = prior ? prior.current : existing ? existing.previous : undefined;
        const baselineOnly = previous === undefined; // very first reading, nothing to compare with: it becomes the starting point and nothing is billed
        if (baselineOnly) previous = f.current;
        if (f.current < previous) throw E.bad(`Reading ${f.current} is lower than the last one (${previous}). If the meter was replaced, tick "new meter" and enter its opening reading.`);
        const units = unitsOf(f.current, previous);
        const rec = { ownerId: unit.ownerId, propertyId: prop.id, unitId: unit.id, tenantId: unit.tenantId, utility: b.utility, period: b.period, previous, current: f.current, units, reset: !!f.reset || undefined, baseline: baselineOnly || undefined, note: f.note || '', recordedBy: ctx.user.id };
        const saved = existing ? db.readings.update(existing.id, (x) => Object.assign(x, rec, { invoiceId: null, amount: null })) : db.readings.insert(rec);
        res.units = units; res.baseline = baselineOnly;
        const avg = recentUnits(unit.id, b.utility, b.period);
        if (avg.length && units > 3 * (avg.reduce((a, x) => a + x, 0) / avg.length) && units > 5) res.warning = 'Much higher than usual. Please check the reading.';
        if (b.bill && !baselineOnly) { const bl = billReading(ctx, saved, prop, tariff, b.dueDate); res.amount = bl.amount; res.billed = !!bl.invoice; }
      });
      res.ok = true;
    } catch (e) { if (e instanceof U.HttpError) res.error = e.message; else throw e; }
  }
  D.audit(ctx, 'utility.readings_saved', 'property', prop.id, { utility: b.utility, period: b.period, saved: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, billed: !!b.bill });
  return { results, saved: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
});

/* ---------- bill readings that were recorded earlier (e.g. by the caretaker) ---------- */
H.route('POST', '/api/utilities/bill', { perm: 'rent.charge', rate: [30, 60000] }, async (ctx) => {
  const b = clean(ctx.body, { propertyId: { t: 'id', req: true }, utility: utilField, period: periodField, dueDate: { t: 'd' } });
  const prop = D.getProperty(b.propertyId, ctx);
  const tariff = tariffOf(prop, b.utility);
  if (!tariff.enabled) throw E.conflict(`${tariff.label} billing is not switched on for this property. Set the rate first.`);
  let billed = 0, total = 0; const skipped = [];
  for (const r of db.readings.byProp(prop.id).filter((x) => live(x) && x.utility === b.utility && x.period === b.period && !x.baseline)) {
    if (readingBilled(r)) continue;
    try { S.tx(() => { const x = billReading(ctx, r, prop, tariff, b.dueDate); if (x.invoice) { billed++; total = D.r2(total + x.amount); } }); } catch (e) { if (e instanceof U.HttpError) skipped.push({ unitId: r.unitId, error: e.message }); else throw e; }
  }
  return { billed, total, skipped };
});

/* ---------- consumption history for one unit ---------- */
H.route('GET', '/api/utilities/history', { perm: 'utility.read' }, async (ctx) => {
  const b = clean(ctx.query, { unitId: { t: 'id', req: true }, utility: utilField });
  const unit = D.getScoped(db.units, b.unitId, ctx);
  const rows = db.readings.where('unitId', unit.id).filter((r) => live(r) && r.utility === b.utility && !r.baseline).sort((a, c) => c.period.localeCompare(a.period)).slice(0, 24);
  const money_ = CAN_MONEY(ctx);
  return { unit: { id: unit.id, name: unit.name }, readings: rows.map((r) => ({ id: r.id, period: r.period, previous: r.previous, current: r.current, units: r.units, billed: readingBilled(r), amount: money_ ? r.amount ?? null : undefined })) };
});

module.exports = { tariffOf, UTILITIES };
