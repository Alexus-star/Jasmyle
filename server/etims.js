'use strict';
// KRA eTIMS (OSCU-style) adapter + sale queue. Modes: off | simulate | sandbox | production.
// IMPORTANT: KRA requires every integrator to pass sandbox vetting and certification before production use, and the
// exact paths/fields come from the OSCU/VSCU specification KRA gives you. The paths live in the rules pack
// (Admin > Integrations & tax rules) so they can be corrected without a new release. "simulate" works fully offline.
const S = require('./store');
const { db } = S;
const sec = require('./sec');
const rules = require('./rules');
const gw = require('./gateways');
const U = require('./util');
const { log } = U;

const DEFAULT_TAX = { pin: '', residency: 'resident', entity: 'individual', vatRegistered: false, basis: 'received', propertyUsage: {}, etims: { mode: 'off', bhfId: '00', deviceSerial: '', cmcKeyEnc: '', initAt: null } };
const taxOf = (st) => { const t = (st && st.tax) || {}; return { ...DEFAULT_TAX, ...t, etims: { ...DEFAULT_TAX.etims, ...(t.etims || {}) }, propertyUsage: t.propertyUsage || {} }; };
const eatDt = (ms) => new Date(ms + 3 * 3600e3).toISOString().replace(/[-:T]/g, '').slice(0, 14);

async function call(mode, path, headers, body) {
  const base = rules.get('integrations.etims.' + (mode === 'production' ? 'production' : 'sandbox'));
  return gw.http(base + path, { method: 'POST', headers, body });
}
async function init(ownerId) {
  const st = db.settings.byOwner(ownerId)[0]; const t = taxOf(st); const e = t.etims;
  if (e.mode === 'simulate') return { ok: true, message: 'Practice mode: no contact with KRA.' };
  if (!t.pin || !e.deviceSerial) throw U.E.bad('Save your KRA PIN and the device serial number first.');
  const r = await call(e.mode, rules.get('integrations.etims.paths.init'), {}, { tin: t.pin, bhfId: e.bhfId, dvcSrlNo: e.deviceSerial });
  const d = r.data || {};
  if (String(d.resultCd) !== '000') throw U.E.unavailable('KRA said: ' + (d.resultMsg || 'device initialisation failed (code ' + d.resultCd + ')'));
  const key = d.data && d.data.info && d.data.info.cmcKey;
  if (!key) throw U.E.unavailable('KRA answered but sent no communication key.');
  db.settings.update(st.id, (s) => { const tt = taxOf(s); tt.etims.cmcKeyEnc = sec.encField(key); tt.etims.initAt = Date.now(); s.tax = tt; return s; });
  return { ok: true, message: 'Device registered with KRA.' };
}
function buildSale(q, t, owner) {
  const vat = !!t.vatRegistered; const rate = rules.get('tax.vat.standardRate', 0.16);
  const total = q.amount; const taxbl = vat ? Math.round((total / (1 + rate)) * 100) / 100 : total; const tax = vat ? Math.round((total - taxbl) * 100) / 100 : 0;
  const cd = vat ? 'B' : 'D'; const z = (v, k) => (k === cd ? v : 0);
  return {
    tin: t.pin, bhfId: t.etims.bhfId, invcNo: q.seq, orgInvcNo: 0, custTin: q.custPin || null, custNm: q.tenantName, salesTyCd: 'N', rcptTyCd: 'S', pmtTyCd: q.method === 'mpesa' ? '06' : q.method === 'cash' ? '01' : '05', salesSttsCd: '02',
    cfmDt: eatDt(q.paidAt), salesDt: eatDt(q.paidAt).slice(0, 8), totItemCnt: 1,
    taxblAmtA: 0, taxblAmtB: z(taxbl, 'B'), taxblAmtC: 0, taxblAmtD: z(taxbl, 'D'), taxblAmtE: 0, taxRtA: 0, taxRtB: vat ? rate * 100 : 0, taxRtC: 0, taxRtD: 0, taxRtE: 0,
    taxAmtA: 0, taxAmtB: z(tax, 'B'), taxAmtC: 0, taxAmtD: 0, taxAmtE: 0, totTaxblAmt: taxbl, totTaxAmt: tax, totAmt: total, regrId: 'Jasmyle Properties', regrNm: 'Jasmyle Properties', modrId: 'Jasmyle Properties', modrNm: 'Jasmyle Properties',
    receipt: { custTin: q.custPin || null, custMblNo: q.phone || null, rptNo: q.seq, trdeNm: owner.company || owner.name, adrs: q.property, topMsg: 'Rent', btmMsg: 'Thank you', prchrAcptcYn: 'N' },
    itemList: [{ itemSeq: 1, itemCd: 'KE2NTXU0000001', itemClsCd: '7010000000', itemNm: 'Rent ' + (q.unit || ''), pkgUnitCd: 'NT', pkg: 1, qtyUnitCd: 'U', qty: 1, prc: total, splyAmt: total, dcRt: 0, dcAmt: 0, taxTyCd: cd, taxblAmt: taxbl, taxAmt: tax, totAmt: total }],
  };
}
async function send(q) {
  const owner = db.users.get(q.ownerId); const st = db.settings.byOwner(q.ownerId)[0]; const t = taxOf(st); const e = t.etims;
  if (e.mode === 'simulate') return { ok: true, receipt: { rcptNo: q.seq, sdcId: 'SIMULATED', rcptSign: sec.sha256(q.id).slice(0, 16).toUpperCase(), intrlData: 'SIMULATED', at: Date.now() } };
  if (!e.cmcKeyEnc) await init(q.ownerId);
  const key = sec.decField(taxOf(db.settings.byOwner(q.ownerId)[0]).etims.cmcKeyEnc);
  const r = await call(e.mode, rules.get('integrations.etims.paths.sales'), { tin: t.pin, bhfId: e.bhfId, cmcKey: key }, buildSale(q, t, owner));
  const d = r.data || {};
  if (String(d.resultCd) === '000' && d.data) return { ok: true, receipt: { rcptNo: d.data.rcptNo, sdcId: d.data.sdcId, rcptSign: d.data.rcptSign, intrlData: d.data.intrlData, vsdcRcptPbctDate: d.data.vsdcRcptPbctDate, mrcNo: d.data.mrcNo, at: Date.now() } };
  return { ok: false, error: `${d.resultCd || r.status}: ${d.resultMsg || 'rejected'}` };
}

/** Queue completed rent payments that need an eTIMS invoice (commercial units, or any unit if the landlord is VAT-registered). */
function enqueue() {
  let n = 0;
  for (const st of db.settings.all()) {
    const t = taxOf(st); if (t.etims.mode === 'off') continue;
    const since = Date.now() - 14 * 86400e3;
    for (const p of db.payments.byOwner(st.ownerId)) {
      if (p.status !== 'completed' || (p.paidAt || 0) < since || (p.simulated && t.etims.mode !== 'simulate')) continue;
      const rent = (p.allocations || []).filter((a) => a.type === 'rent').reduce((a, x) => a + x.amount, 0);
      if (rent <= 0) continue;
      if (!(t.propertyUsage[p.propertyId] === 'commercial' || t.vatRegistered)) continue;
      if (db.etims.byOwner(st.ownerId).some((q) => q.paymentId === p.id)) continue;
      const ten = db.users.get(p.tenantId) || {}; const unit = db.units.get(p.unitId) || {}; const prop = db.properties.get(p.propertyId) || {};
      try { db.etims.insert({ ownerId: st.ownerId, propertyId: p.propertyId, paymentId: p.id, seq: S.meta.incr('etims:seq:' + st.ownerId), amount: Math.round(rent * 100) / 100, method: p.method, paidAt: p.paidAt, tenantName: ten.name || '', phone: ten.phone || '', unit: unit.name || '', property: prop.name || '', status: 'pending', attempts: 0 }); n++; } catch (e) { if (e.code !== 'duplicate') log('warn', 'etims enqueue: ' + e.message); }
    }
  }
  return n;
}
async function processQueue() {
  let ok = 0;
  const due = db.etims.all().filter((q) => (q.status === 'pending' || q.status === 'failed') && q.attempts < 8 && Date.now() >= (q.nextAt || 0)).slice(0, 25);
  for (const q of due) {
    try {
      const r = await send(q);
      if (r.ok) { db.etims.update(q.id, { status: 'sent', receipt: r.receipt, error: null }); ok++; }
      else db.etims.update(q.id, { status: 'failed', attempts: q.attempts + 1, error: r.error, nextAt: Date.now() + Math.min(6 * 3600e3, 2 ** q.attempts * 300e3) });
    } catch (e) { db.etims.update(q.id, { status: 'failed', attempts: q.attempts + 1, error: e.message, nextAt: Date.now() + Math.min(6 * 3600e3, 2 ** q.attempts * 300e3) }); }
  }
  return ok;
}
module.exports = { taxOf, DEFAULT_TAX, init, enqueue, processQueue, send, buildSale };
