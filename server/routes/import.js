'use strict';
// CSV bulk import of units and tenants. Always safe to preview first (dryRun): nothing is saved until the person confirms.
// Each row stands alone: good rows are saved, bad rows are reported with the reason, so the file can be fixed and re-sent.
const S = require('../store');
const { db } = S;
const U = require('../util');
const { E, clean } = U;
const R = require('../roles');
const H = require('../http');
const D = require('../domain');
const P = require('../platform');
const C = require('./core');

/* ---------- CSV parser (quotes, BOM, CRLF, comma / semicolon / tab) ---------- */
function parseCsv(text) {
  text = String(text || '').replace(/^﻿/, '');
  const first = text.split(/\r?\n/, 1)[0] || '';
  const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = []; let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x.trim() !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const ALIAS = {
  property: ['property', 'propertyname', 'building', 'plot'], unit: ['unit', 'unitname', 'unitnumber', 'house', 'houseno', 'unitno', 'name'],
  type: ['type', 'unittype'], bedrooms: ['bedrooms', 'beds', 'bedroom'], rent: ['rent', 'monthlyrent', 'rentkes', 'amount'], deposit: ['deposit', 'depositkes'], floor: ['floor'],
  name: ['name', 'tenant', 'tenantname', 'fullname'], phone: ['phone', 'phonenumber', 'mobile', 'tel', 'msisdn'], email: ['email', 'emailaddress'],
  nationalId: ['nationalid', 'id', 'idnumber', 'idno'], movein: ['movein', 'moveindate', 'startdate', 'start', 'leasestart'], dueDay: ['dueday', 'rentdueday', 'dueon'],
  emergencyContact: ['emergencycontact', 'emergency', 'nextofkin'],
};
function toObjects(rows, kind) {
  if (rows.length < 2) throw E.bad('The file needs a header row and at least one data row.');
  const heads = rows[0].map(norm);
  const idx = {};
  for (const [k, al] of Object.entries(ALIAS)) {
    if (kind === 'tenants' && k === 'unit') { idx[k] = heads.findIndex((h) => ['unit', 'unitname', 'unitnumber', 'house', 'houseno', 'unitno'].includes(h)); continue; }
    if (kind === 'units' && (k === 'name' || k === 'phone')) continue;
    idx[k] = heads.findIndex((h) => al.includes(h));
  }
  if (kind === 'units' && idx.unit < 0) throw E.bad('Missing a "unit" column (the unit name or number).');
  if (kind === 'tenants') for (const need of ['unit', 'name', 'phone']) if (idx[need] < 0) throw E.bad(`Missing a "${need}" column. Download the template to see the expected columns.`);
  return rows.slice(1).map((r, i) => {
    const o = { _row: i + 2 };
    for (const [k, ix] of Object.entries(idx)) o[k] = ix >= 0 ? String(r[ix] ?? '').trim() : '';
    return o;
  });
}
const MAXROWS = { units: 1000, tenants: 500 };

const TEMPLATES = {
  units: 'property,unit,type,bedrooms,rent,deposit,floor\nSunrise Apartments,A1,Bedsitter,0,9000,9000,Ground\nSunrise Apartments,B1,1 Bedroom,1,18000,18000,1\n',
  tenants: 'property,unit,name,phone,email,national_id,move_in,rent,deposit,due_day,emergency_contact\nSunrise Apartments,A1,Jane Wanjiru,0712345678,jane@example.com,12345678,2025-03-01,9000,9000,5,0722000111\n',
};
H.route('GET', '/api/import/template', { anyPerm: ['unit.write', 'tenant.write'] }, async (ctx) => {
  const kind = ctx.query.kind === 'tenants' ? 'tenants' : 'units';
  ctx.send(200, Buffer.from(TEMPLATES[kind]), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="jasmyle-${kind}-template.csv"`, 'Cache-Control': 'no-store' });
});

function propertyLookup(ctx) {
  const m = new Map();
  for (const p of D.listScoped(db.properties, ctx).filter((x) => x.status !== 'archived')) m.set(p.name.trim().toLowerCase(), p);
  return m;
}
function pickProperty(map, name, fallback) {
  if (!name) { if (fallback) return fallback; if (map.size === 1) return [...map.values()][0]; throw E.bad('Property is missing (and you have more than one)'); }
  const p = map.get(name.toLowerCase());
  if (!p) throw E.bad(`Property "${name}" not found. Spelling must match exactly.`);
  return p;
}
const num = (v, label, o = {}) => (v === '' ? undefined : (() => { const n = Number(String(v).replace(/[, ]/g, '')); if (!Number.isFinite(n)) throw E.bad(`${label} must be a number`); return n; })());
const typeOf = (v) => (C.UNIT_TYPES.find((t) => norm(t) === norm(v)) || (v ? null : '1 Bedroom'));
function dateOf(v, label) {
  if (!v) return undefined;
  let s = v.trim();
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // 01/03/2025 = 1 March 2025 (Kenyan day-first)
  if (m) s = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (!U.isDate(s)) throw E.bad(`${label} "${v}" is not a date. Use YYYY-MM-DD or DD/MM/YYYY.`);
  return s;
}

/* ---------- units ---------- */
H.route('POST', '/api/import/units', { perm: 'unit.write', rate: [20, 60000], rawMax: 1024 * 1024 }, async (ctx) => {
  const b = clean(ctx.body, { csv: { t: 's', req: true, max: 900000, raw: true, label: 'CSV file' }, dryRun: { t: 'b', def: true }, propertyId: { t: 'id' } });
  if (!b.dryRun) P.assertCanGrow(ctx.scope.ownerId);
  const objs = toObjects(parseCsv(b.csv), 'units');
  if (objs.length > MAXROWS.units) throw E.bad(`Too many rows (max ${MAXROWS.units} per file)`);
  const props = propertyLookup(ctx); const fallback = b.propertyId ? D.getProperty(b.propertyId, ctx) : null;
  const seen = new Set(); const rows = []; let created = 0;
  for (const o of objs) {
    const res = { row: o._row, label: o.unit, status: 'ok', message: '' };
    rows.push(res);
    try {
      const p = pickProperty(props, o.property, fallback);
      const type = typeOf(o.type); if (!type) throw E.bad(`Unit type "${o.type}" is not one of: ${C.UNIT_TYPES.join(', ')}`);
      const f = clean({ name: o.unit, type, bedrooms: num(o.bedrooms, 'Bedrooms'), rent: num(o.rent, 'Rent'), deposit: num(o.deposit, 'Deposit'), floor: o.floor }, { name: C.UNIT_FIELDS.name, type: C.UNIT_FIELDS.type, bedrooms: C.UNIT_FIELDS.bedrooms, rent: C.UNIT_FIELDS.rent, deposit: C.UNIT_FIELDS.deposit, floor: C.UNIT_FIELDS.floor });
      const key = p.id + '|' + f.name.toLowerCase();
      if (seen.has(key)) throw E.conflict('Listed twice in this file');
      seen.add(key);
      if (db.units.byProp(p.id).some((u) => !u.archived && u.name.toLowerCase() === f.name.toLowerCase())) throw E.conflict('Already exists in this property');
      res.label = `${p.name} / ${f.name}`;
      if (!b.dryRun) { db.units.insert({ ownerId: p.ownerId, propertyId: p.id, ...f, listed: false, status: 'vacant', vacantSince: U.todayStr(), tenantId: null, leaseId: null }); created++; }
    } catch (e) { if (!(e instanceof U.HttpError)) throw e; res.status = 'error'; res.message = e.message; }
  }
  if (!b.dryRun) D.audit(ctx, 'import.units', 'unit', null, { created, failed: rows.filter((r) => r.status === 'error').length });
  return { dryRun: b.dryRun, total: rows.length, ok: rows.filter((r) => r.status === 'ok').length, failed: rows.filter((r) => r.status === 'error').length, created, rows };
});

/* ---------- tenants (creates the account and the lease) ---------- */
function phoneBlocked(phone, email) { // read-only version of releaseFormer's checks, for the preview
  for (const [f, v] of [['phone', phone], ['email', email]]) {
    if (!v) continue;
    const ex = db.users.find(f, v);
    if (!ex) continue;
    if (ex.role !== 'tenant') return `That ${f} is already registered to another account.`;
    if (db.leases.where('tenantId', ex.id).some((l) => l.status === 'active')) return `That ${f} belongs to a tenant who currently has a lease.`;
  }
  return null;
}
H.route('POST', '/api/import/tenants', { perm: 'tenant.write', rate: [10, 60000], rawMax: 1024 * 1024 }, async (ctx) => {
  D.need(ctx, 'lease.write');
  const b = clean(ctx.body, {
    csv: { t: 's', req: true, max: 900000, raw: true, label: 'CSV file' }, dryRun: { t: 'b', def: true }, propertyId: { t: 'id' },
    billFromThisMonth: { t: 'b', def: true }, depositAlreadyPaid: { t: 'b', def: true },
  });
  if (!b.dryRun) P.assertCanGrow(ctx.scope.ownerId);
  const objs = toObjects(parseCsv(b.csv), 'tenants');
  if (objs.length > MAXROWS.tenants) throw E.bad(`Too many rows (max ${MAXROWS.tenants} per file)`);
  const props = propertyLookup(ctx); const fallback = b.propertyId ? D.getProperty(b.propertyId, ctx) : null;
  const canRent = R.can(ctx.user, 'lease.rent');
  const seenUnit = new Set(); const seenPhone = new Set();
  const rows = []; const credentials = []; let created = 0;
  for (const o of objs) {
    const res = { row: o._row, label: o.name, status: 'ok', message: '' };
    rows.push(res);
    try {
      const p = pickProperty(props, o.property, fallback);
      const unit = db.units.byProp(p.id).find((u) => !u.archived && u.name.toLowerCase() === o.unit.toLowerCase());
      if (!unit) throw E.bad(`Unit "${o.unit}" not found in ${p.name}. Import the units first.`);
      if (unit.status !== 'vacant') throw E.conflict(`Unit ${unit.name} is not vacant (${unit.status}).`);
      const ukey = unit.id; if (seenUnit.has(ukey)) throw E.conflict('Another row in this file uses the same unit');
      const f = clean({ name: o.name, phone: o.phone, email: o.email, nationalId: o.nationalId, emergencyContact: o.emergencyContact, startDate: dateOf(o.movein, 'Move-in date') || U.todayStr(), rent: num(o.rent, 'Rent'), deposit: num(o.deposit, 'Deposit'), dueDay: num(o.dueDay, 'Due day') },
        { name: { t: 's', req: true, max: 80, min: 2 }, phone: { t: 'phone', req: true }, email: { t: 'email' }, nationalId: { t: 's', max: 20, re: C.NID_RE, label: 'ID number' }, emergencyContact: { t: 's', max: 120 }, startDate: C.LEASE_FIELDS.startDate, rent: C.LEASE_FIELDS.rent, deposit: C.LEASE_FIELDS.deposit, dueDay: C.LEASE_FIELDS.dueDay });
      if ((f.rent !== undefined && f.rent !== unit.rent) || (f.deposit !== undefined && f.deposit !== unit.deposit)) { if (!canRent) throw E.forbidden('Only the landlord can import a rent or deposit different from the unit\'s listed amount.'); }
      if (seenPhone.has(f.phone)) throw E.conflict('Same phone number used twice in this file');
      const blocked = phoneBlocked(f.phone, f.email); if (blocked) throw E.conflict(blocked);
      seenUnit.add(ukey); seenPhone.add(f.phone);
      res.label = `${f.name} → ${p.name} / ${unit.name}`;
      if (!b.dryRun) {
        const lf = { ...f };
        if (b.billFromThisMonth) lf.billFrom = U.monthOf(U.todayStr());
        if (b.depositAlreadyPaid) lf.skipDepositInvoice = true;
        const made = await C.addTenantToUnit(ctx, unit, lf);
        created++;
        credentials.push({ row: o._row, name: f.name, phone: f.phone, unit: unit.name, property: p.name, tempPassword: made.tempPassword });
      }
    } catch (e) { if (!(e instanceof U.HttpError)) throw e; res.status = 'error'; res.message = e.message; }
  }
  if (!b.dryRun) D.audit(ctx, 'import.tenants', 'user', null, { created, failed: rows.filter((r) => r.status === 'error').length, billFromThisMonth: b.billFromThisMonth });
  return { dryRun: b.dryRun, total: rows.length, ok: rows.filter((r) => r.status === 'ok').length, failed: rows.filter((r) => r.status === 'error').length, created, rows, credentials };
});

module.exports = { parseCsv };
