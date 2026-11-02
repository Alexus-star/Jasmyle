'use strict';
// Kenya tax helper for landlords: rental income tax (MRI), VAT on commercial rent, non-resident rules, eTIMS invoices.
// It PREPARES the numbers, deadlines and files. Filing/payment itself is done by the landlord on KRA iTax / eRITS -
// KRA publishes no public API for filing MRI returns, so nothing here pretends to file on your behalf.
const S = require('../store');
const { db } = S;
const U = require('../util');
const { E, clean } = U;
const rules = require('../rules');
const H = require('../http');
const D = require('../domain');
const ET = require('../etims');
const sec = require('../sec');

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const monthParam = (m) => (/^\d{4}-(0[1-9]|1[0-2])$/.test(m || '') ? m : U.monthOf(U.todayStr()));
const nextMonthDue = (month, day) => { const [y, m] = month.split('-').map(Number); const d = new Date(Date.UTC(y, m, day)); return d.toISOString().slice(0, 10); };

function summary(ctx, month) {
  const st = D.ensureSettings(ctx.scope.ownerId); const t = ET.taxOf(st);
  const R = rules.all().tax; const today = U.todayStr();
  const props = D.listScoped(db.properties, ctx).filter((p) => p.status !== 'archived');
  const ids = new Set(props.map((p) => p.id));
  const usage = (pid) => (t.propertyUsage[pid] === 'commercial' ? 'commercial' : 'residential');
  const rows = new Map(props.map((p) => [p.id, { id: p.id, name: p.name, usage: usage(p.id), gross: 0 }]));
  if (t.basis === 'invoiced') {
    for (const i of D.listScoped(db.invoices, ctx)) if (i.type === 'rent' && i.status !== 'void' && i.period === month && rows.has(i.propertyId)) rows.get(i.propertyId).gross += i.amount;
  } else {
    for (const p of D.listScoped(db.payments, ctx)) {
      if (p.status !== 'completed' || !ids.has(p.propertyId) || U.dateOf(p.paidAt || p.createdAt).slice(0, 7) !== month) continue;
      const rent = (p.allocations || []).filter((a) => a.type === 'rent').reduce((a, x) => a + x.amount, 0);
      rows.get(p.propertyId).gross += rent;
    }
  }
  const list = [...rows.values()].map((r) => ({ ...r, gross: r2(r.gross) }));
  const resGross = r2(list.filter((r) => r.usage === 'residential').reduce((a, r) => a + r.gross, 0));
  const comGross = r2(list.filter((r) => r.usage === 'commercial').reduce((a, r) => a + r.gross, 0));
  const annual = r2(D.listScoped(db.leases, ctx).filter((l) => l.status === 'active' && ids.has(l.propertyId) && usage(l.propertyId) === 'residential').reduce((a, l) => a + (l.rent || 0), 0) * 12);
  const warnings = []; let regime, why;
  if (t.residency === 'nonresident') { regime = 'nonresident'; why = `Non-resident landlords: ${R.nonResidentRental.rate * 100}% of gross rent, self-declared by the ${R.nonResidentRental.dueDay}th of the following month (or withholding by the tenant/agent).`; }
  else if (annual > R.mri.annualMax) { regime = 'income_tax'; why = `Residential rent above KES ${R.mri.annualMax.toLocaleString()} a year is outside MRI. It is taxed in your annual income tax return.`; }
  else if (annual < R.mri.annualMin) { regime = 'exempt'; why = `Residential rent under KES ${R.mri.annualMin.toLocaleString()} a year is outside MRI (no monthly return needed).`; }
  else { regime = 'mri'; why = `Residential rent between KES ${R.mri.annualMin.toLocaleString()} and ${R.mri.annualMax.toLocaleString()} a year: Monthly Rental Income tax at ${r2(R.mri.rate * 100)}% of gross rent, no expense deductions.`; }
  let rate = 0; if (regime === 'mri') rate = R.mri.rate; else if (regime === 'nonresident') rate = R.nonResidentRental.rate;
  const taxDue = r2(resGross * rate);
  const dueDate = nextMonthDue(month, R.mri.dueDay); const late = U.daysBetween(dueDate, today);
  let penalty = 0;
  if (late > 0 && taxDue > 0) { const minP = t.entity === 'company' ? R.mri.penaltyMinCompany : R.mri.penaltyMinIndividual; const months = Math.ceil(late / 30); penalty = r2(Math.max(taxDue * R.mri.penaltyPct, minP) + taxDue * R.mri.interestMonthly * months); }
  const vatRate = R.vat.standardRate; const vatOut = t.vatRegistered ? r2(comGross * vatRate) : 0;
  if (!t.pin) warnings.push('Add your KRA PIN in Tax settings - needed for returns and eTIMS invoices.');
  if (comGross > 0 && !t.vatRegistered) warnings.push(`You collect commercial rent. If your taxable supplies exceed KES ${R.vat.registrationThreshold.toLocaleString()} a year you must register for VAT (${vatRate * 100}% on commercial rent). Residential rent is VAT-exempt.`);
  if (t.vatRegistered && t.etims.mode === 'off') warnings.push('You are VAT-registered: every rent receipt needs an eTIMS invoice. Turn eTIMS on below.');
  if (R.mri.pendingChange && regime === 'mri') warnings.push('Rate watch: ' + R.mri.pendingChange);
  if (regime === 'mri' && resGross === 0 && month <= U.monthOf(today)) warnings.push('No residential rent received this month. A nil return is still required on iTax if you are registered for MRI.');
  return { month, basis: t.basis, regime, regimeReason: why, annualResidentialRent: annual, properties: list, residentialGross: resGross, commercialGross: comGross,
    rate, taxDue, dueDate, daysLate: Math.max(0, late), penaltyEstimate: penalty, status: taxDue <= 0 ? 'nothing_due' : late > 0 ? 'overdue' : 'upcoming',
    vat: { registered: !!t.vatRegistered, rate: vatRate, base: comGross, outputVat: vatOut, note: 'Assumes your commercial rents are quoted excluding VAT.' }, warnings, rulesVersion: rules.all().version, rulesIssued: rules.all().issuedAt,
    filing: { where: 'KRA iTax (iTax > Returns > File Return > Monthly Rental Income) or eRITS on the KRA website/app', note: 'Pay with the PRN KRA generates (M-Pesa paybill 572572, or bank). Jasmyle Properties prepares the figures; it does not file for you.' } };
}

const view = (st) => { const t = ET.taxOf(st); return { pin: t.pin, residency: t.residency, entity: t.entity, vatRegistered: t.vatRegistered, basis: t.basis, etims: { mode: t.etims.mode, bhfId: t.etims.bhfId, deviceSerial: t.etims.deviceSerial, registered: !!t.etims.cmcKeyEnc, initAt: t.etims.initAt } }; };

H.route('GET', '/api/tax', { perm: 'tax.read' }, async (ctx) => {
  const st = D.ensureSettings(ctx.scope.ownerId); const t = ET.taxOf(st);
  const props = D.listScoped(db.properties, ctx).filter((p) => p.status !== 'archived').map((p) => ({ id: p.id, name: p.name, usage: t.propertyUsage[p.id] === 'commercial' ? 'commercial' : 'residential' }));
  const queue = D.listScoped(db.etims, ctx).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50).map((q) => ({ id: q.id, seq: q.seq, tenantName: q.tenantName, unit: q.unit, amount: q.amount, status: q.status, attempts: q.attempts, error: q.error || null, receipt: q.receipt || null, paidAt: q.paidAt }));
  const rl = rules.all();
  return { settings: view(st), properties: props, summary: summary(ctx, monthParam(ctx.query.month)), etimsQueue: queue, canEdit: R_can(ctx, 'tax.write'), rules: { version: rl.version, issuedAt: rl.issuedAt, mriRate: rl.tax.mri.rate, vatRate: rl.tax.vat.standardRate, etimsVerified: !!rl.integrations.etims.verified } };
});
const R_can = (ctx, p) => require('../roles').can(ctx.user, p);
H.route('GET', '/api/tax/summary', { perm: 'tax.read' }, async (ctx) => ({ summary: summary(ctx, monthParam(ctx.query.month)) }));
H.route('PUT', '/api/tax', { perm: 'tax.write' }, async (ctx) => {
  const b = clean(ctx.body, { pin: { t: 's', max: 11, re: /^([AP]\d{9}[A-Z])?$/i, label: 'KRA PIN (like A001234567Z)' }, residency: { t: 'e', values: ['resident', 'nonresident'], req: true }, entity: { t: 'e', values: ['individual', 'company'], req: true }, vatRegistered: { t: 'b' }, basis: { t: 'e', values: ['received', 'invoiced'], req: true },
    etimsMode: { t: 'e', values: ['off', 'simulate', 'sandbox', 'production'], req: true }, bhfId: { t: 's', max: 4, re: /^\d{0,4}$/ }, deviceSerial: { t: 's', max: 40 } });
  const usage = ctx.body.propertyUsage && typeof ctx.body.propertyUsage === 'object' ? ctx.body.propertyUsage : {};
  const st = D.ensureSettings(ctx.scope.ownerId); const mine = new Set(db.properties.byOwner(ctx.scope.ownerId).map((p) => p.id));
  if (b.etimsMode === 'production' && !rules.get('integrations.etims.verified')) throw E.bad('Production eTIMS stays locked until KRA has certified the integration and an administrator marks the rules pack as verified. Use sandbox or practice mode meanwhile.');
  db.settings.update(st.id, (s) => {
    const t = ET.taxOf(s); const pu = { ...t.propertyUsage };
    for (const [k, v] of Object.entries(usage)) if (mine.has(k) && (v === 'commercial' || v === 'residential')) pu[k] = v;
    s.tax = { ...t, pin: (b.pin || '').toUpperCase(), residency: b.residency, entity: b.entity, vatRegistered: !!b.vatRegistered, basis: b.basis, propertyUsage: pu, etims: { ...t.etims, mode: b.etimsMode, bhfId: b.bhfId || '00', deviceSerial: b.deviceSerial || '', cmcKeyEnc: b.deviceSerial !== t.etims.deviceSerial || b.etimsMode !== t.etims.mode ? '' : t.etims.cmcKeyEnc } };
    return s;
  });
  D.audit(ctx, 'tax.settings_updated', 'settings', st.id, { residency: b.residency, vat: !!b.vatRegistered, etims: b.etimsMode });
  return { ok: true };
});
H.route('POST', '/api/tax/etims/init', { perm: 'tax.write', rate: [6, 60000] }, async (ctx) => { const r = await ET.init(ctx.scope.ownerId); D.audit(ctx, 'tax.etims_init', 'settings', null); return r; });
H.route('POST', '/api/tax/etims/:id/retry', { perm: 'tax.write', rate: [20, 60000] }, async (ctx) => {
  const q = D.getScoped(db.etims, ctx.params.id, ctx); if (q.status === 'sent') throw E.conflict('Already sent.');
  db.etims.update(q.id, { status: 'pending', nextAt: 0, attempts: Math.min(q.attempts, 7) }); const n = await ET.processQueue(); return { processed: n };
});
H.route('GET', '/api/tax/export', { perm: 'tax.read' }, async (ctx) => {
  const s = summary(ctx, monthParam(ctx.query.month)); const t = ET.taxOf(D.ensureSettings(ctx.scope.ownerId));
  const rows = [['KRA PIN', 'Month', 'Property', 'Use', 'Gross rent received (KES)', 'Tax regime', 'Rate', 'Tax due (KES)', 'Due date']];
  for (const p of s.properties) rows.push([t.pin, s.month, p.name, p.usage, p.gross, p.usage === 'residential' ? s.regime : 'income tax / VAT', p.usage === 'residential' ? s.rate : '', p.usage === 'residential' ? r2(p.gross * s.rate) : '', s.dueDate]);
  rows.push([], ['TOTAL residential', '', '', '', s.residentialGross, '', s.rate, s.taxDue, s.dueDate], ['TOTAL commercial', '', '', '', s.commercialGross, '', '', '', ''], ['VAT output (est.)', '', '', '', s.vat.base, '', s.vat.rate, s.vat.outputVat, '']);
  D.audit(ctx, 'tax.exported', 'report', null, { month: s.month });
  ctx.send(200, Buffer.from('﻿' + U.toCsv(rows), 'utf8'), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="tax-${s.month}.csv"` });
});
module.exports = { summary };
