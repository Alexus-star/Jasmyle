'use strict';
// Properties, units, tenants, leases, staff accounts and settings - all filtered through the caller's scope.
const S = require('../store');
const { db } = S;
const U = require('../util');
const { E, clean } = U;
const sec = require('../sec');
const R = require('../roles');
const H = require('../http');
const D = require('../domain');
const A = require('./auth');
const gw = require('../gateways');
const P = require('../platform');

/** A phone/email still attached to a FORMER tenant (no active lease) is released so the person can rent from another landlord. */
function releaseFormer(phone, email, exceptId) {
  for (const [f, v] of [['phone', phone], ['email', email]]) {
    if (!v) continue;
    const ex = db.users.find(f, v);
    if (!ex || ex.id === exceptId) continue;
    if (ex.role !== 'tenant') throw E.conflict(f === 'phone' ? 'That phone number is already registered.' : 'That email address is already registered.', 'duplicate');
    if (db.leases.where('tenantId', ex.id).some((l) => l.status === 'active')) throw E.conflict(`That ${f} belongs to a tenant who currently has a lease. A number can be used by only one active tenant.`, 'duplicate');
    db.users.update(ex.id, { [f]: undefined, ['former' + f[0].toUpperCase() + f.slice(1)]: v });
    if (f === 'phone') A.killSessions(ex.id);
  }
}

const AMEN = ['Water 24/7', 'Borehole', 'Backup generator', 'Parking', 'CCTV', 'Security guard', 'Electric fence', 'Gated compound', 'Balcony', 'Lift', 'WiFi ready', 'Pets allowed', 'Playground', 'Garbage collection'];
const UNIT_TYPES = ['Bedsitter', 'Studio', '1 Bedroom', '2 Bedroom', '3 Bedroom', '4 Bedroom', 'Maisonette', 'Shop', 'Office', 'Other'];

/* ======================= PROPERTIES ======================= */
const propView = (p) => {
  const units = db.units.byProp(p.id).filter((x) => !x.archived);
  const occ = units.filter((x) => x.status === 'occupied').length;
  return { ...p, unitCount: units.length, occupied: occ, vacant: units.filter((x) => x.status === 'vacant').length, occupancy: units.length ? Math.round((occ / units.length) * 100) : 0 };
};
const PROP_FIELDS = {
  name: { t: 's', req: true, max: 100, min: 2, label: 'Property name' }, address: { t: 's', max: 200 }, county: { t: 's', req: true, max: 40, label: 'County' }, town: { t: 's', req: true, max: 60, label: 'Town / area' },
  description: { t: 's', max: 1500 }, amenities: { t: 'strs', max: 20 }, rules: { t: 's', max: 1000 },
};

H.route('GET', '/api/properties', { perm: 'property.read' }, async (ctx) => {
  const rows = D.listScoped(db.properties, ctx).filter((p) => p.status !== 'archived').map(propView).sort((a, b) => a.name.localeCompare(b.name));
  return { properties: rows, amenityOptions: AMEN };
});
H.route('POST', '/api/properties', { perm: 'property.create' }, async (ctx) => {
  P.assertCanGrow(ctx.scope.ownerId);
  const b = clean(ctx.body, PROP_FIELDS);
  const id = U.newId('prp');
  const p = db.properties.insert({ id, propertyId: id, ownerId: ctx.scope.ownerId, ...b, amenities: b.amenities || [], verified: false, status: 'active', createdBy: ctx.user.id });
  D.audit(ctx, 'property.created', 'property', p.id, { name: p.name });
  for (const a of db.users.where('role', 'national_admin')) D.notify(a.id, 'Property awaiting verification', `${p.name}, ${p.town}`, 'admin', '#/admin/properties');
  return { property: propView(p) };
});
H.route('GET', '/api/properties/:id', { perm: 'property.read' }, async (ctx) => {
  const p = D.getProperty(ctx.params.id, ctx);
  const staff = R.can(ctx.user, 'staff.manage') ? db.users.byOwner(p.ownerId).filter((u) => ['property_manager', 'caretaker'].includes(u.role) && (u.assignedPropertyIds || []).includes(p.id)).map((u) => ({ id: u.id, name: u.name, role: u.role })) : [];
  return { property: propView(p), staff };
});
H.route('PUT', '/api/properties/:id', { anyPerm: ['property.update', 'property.update.basic'] }, async (ctx) => {
  const p = D.getProperty(ctx.params.id, ctx);
  const full = R.can(ctx.user, 'property.update');
  const fields = full ? { ...PROP_FIELDS, version: { t: 'n', req: true, int: true } } : { description: PROP_FIELDS.description, amenities: PROP_FIELDS.amenities, rules: PROP_FIELDS.rules, version: { t: 'n', req: true, int: true } };
  const b = clean(ctx.body, fields);
  const { version, ...patch } = b;
  const moved = full && (patch.name !== p.name || patch.county !== p.county || patch.town !== p.town || patch.address !== p.address);
  if (moved && p.verified) { patch.verified = false; patch.verifiedAt = null; } // identity details changed: needs re-verification
  const up = db.properties.update(p.id, patch, version);
  D.audit(ctx, 'property.updated', 'property', p.id, { fields: Object.keys(patch) });
  return { property: propView(up) };
});
H.route('POST', '/api/properties/:id/archive', { perm: 'property.archive' }, async (ctx) => {
  const p = D.getProperty(ctx.params.id, ctx);
  if (db.leases.byProp(p.id).some((l) => l.status === 'active')) throw E.conflict('This property still has tenants. Move them out first.');
  db.properties.update(p.id, { status: 'archived', verified: false });
  D.audit(ctx, 'property.archived', 'property', p.id, { name: p.name });
  return { ok: true };
});

/* ======================= UNITS ======================= */
const UNIT_FIELDS = {
  name: { t: 's', req: true, max: 30, label: 'Unit name / number' }, type: { t: 'e', values: UNIT_TYPES, def: '1 Bedroom' }, bedrooms: { t: 'n', int: true, max: 20, def: 1 },
  rent: { t: 'n', req: true, max: 5e7, label: 'Monthly rent' }, deposit: { t: 'n', max: 5e7, def: 0 }, floor: { t: 's', max: 10 }, description: { t: 's', max: 600 },
  listed: { t: 'b', def: false }, bathrooms: { t: 'n', int: true, max: 20 }, furnished: { t: 'b', def: false }, availableFrom: { t: 'd' },
  tourUrl: { t: 's', max: 200, re: /^(https:\/\/(www\.)?(youtube\.com|youtu\.be|vimeo\.com|my\.matterport\.com|matterport\.com|kuula\.co)\/[^\s]*)?$/, label: 'Virtual tour link (YouTube, Vimeo, Matterport or Kuula)' }, coverFileId: { t: 'id' },
};
const unitView = (u, tenants) => {
  const t = u.tenantId && tenants ? tenants.get(u.tenantId) : null;
  return { ...u, tenantName: t ? t.name : null };
};
H.route('GET', '/api/units', { perm: 'unit.read' }, async (ctx) => {
  let rows = D.listScoped(db.units, ctx).filter((u) => !u.archived);
  if (ctx.query.propertyId) rows = rows.filter((u) => u.propertyId === ctx.query.propertyId);
  if (ctx.query.status) rows = rows.filter((u) => u.status === ctx.query.status);
  const canSee = R.can(ctx.user, 'tenant.read') || R.can(ctx.user, 'tenant.read.basic');
  const tenants = canSee ? new Map(db.users.byOwner(ctx.scope.ownerId).filter((u) => u.role === 'tenant').map((u) => [u.id, u])) : null;
  const props = new Map(D.listScoped(db.properties, ctx).map((p) => [p.id, p.name]));
  rows.sort((a, b) => (props.get(a.propertyId) || '').localeCompare(props.get(b.propertyId) || '') || a.name.localeCompare(b.name, undefined, { numeric: true }));
  return { units: rows.map((u) => ({ ...unitView(u, tenants), propertyName: props.get(u.propertyId) || '' })), unitTypes: UNIT_TYPES };
});
H.route('POST', '/api/units', { perm: 'unit.write' }, async (ctx) => {
  P.assertCanGrow(ctx.scope.ownerId);
  const b = clean(ctx.body, { propertyId: { t: 'id', req: true }, ...UNIT_FIELDS });
  const p = D.getProperty(b.propertyId, ctx);
  const u = db.units.insert({ ownerId: p.ownerId, ...b, status: 'vacant', vacantSince: U.todayStr(), tenantId: null, leaseId: null });
  D.audit(ctx, 'unit.created', 'unit', u.id, { name: u.name, property: p.name });
  return { unit: u };
});
H.route('POST', '/api/units/bulk', { perm: 'unit.write', rate: [20, 60000] }, async (ctx) => {
  P.assertCanGrow(ctx.scope.ownerId);
  const b = clean(ctx.body, {
    propertyId: { t: 'id', req: true }, prefix: { t: 's', max: 10, def: '' }, from: { t: 'n', int: true, req: true, min: 0, max: 99999 }, count: { t: 'n', int: true, req: true, min: 1, max: 500 },
    type: UNIT_FIELDS.type, bedrooms: UNIT_FIELDS.bedrooms, rent: UNIT_FIELDS.rent, deposit: UNIT_FIELDS.deposit, floor: { t: 's', max: 10 },
  });
  const p = D.getProperty(b.propertyId, ctx);
  const made = []; const skipped = [];
  S.tx(() => {
    for (let i = 0; i < b.count; i++) {
      const name = `${b.prefix || ''}${b.from + i}`;
      try { made.push(db.units.insert({ ownerId: p.ownerId, propertyId: p.id, name, type: b.type, bedrooms: b.bedrooms, rent: b.rent, deposit: b.deposit, floor: b.floor || '', listed: false, status: 'vacant', vacantSince: U.todayStr(), tenantId: null, leaseId: null }).id); } catch (e) { if (e.code === 'duplicate') skipped.push(name); else throw e; }
    }
    D.audit(ctx, 'unit.bulk_created', 'property', p.id, { created: made.length, skipped: skipped.length });
  });
  return { created: made.length, skipped };
});
H.route('GET', '/api/units/:id', { perm: 'unit.read' }, async (ctx) => ({ unit: D.getScoped(db.units, ctx.params.id, ctx) }));
H.route('PUT', '/api/units/:id', { perm: 'unit.write' }, async (ctx) => {
  const u = D.getScoped(db.units, ctx.params.id, ctx);
  const b = clean(ctx.body, { ...UNIT_FIELDS, status: { t: 'e', values: ['vacant', 'maintenance'] }, version: { t: 'n', req: true, int: true } });
  const { version, status, ...patch } = b;
  if (status) {
    if (u.status === 'occupied') throw E.conflict('This unit has a tenant. Move the tenant out before changing its status.');
    patch.status = status;
    if (status === 'vacant' && u.status !== 'vacant') patch.vacantSince = U.todayStr();
  }
  if (u.status === 'occupied') patch.listed = false;
  const up = db.units.update(u.id, patch, version);
  D.audit(ctx, 'unit.updated', 'unit', u.id, { fields: Object.keys(patch) });
  return { unit: up };
});
H.route('POST', '/api/units/:id/archive', { perm: 'unit.write' }, async (ctx) => {
  const u = D.getScoped(db.units, ctx.params.id, ctx);
  if (u.status === 'occupied') throw E.conflict('This unit has a tenant.');
  db.units.update(u.id, { archived: true, listed: false });
  D.audit(ctx, 'unit.archived', 'unit', u.id);
  return { ok: true };
});

/* ======================= TENANTS & LEASES ======================= */
const NID_RE = /^[A-Za-z0-9 \-]{4,20}$/;
function tenantView(u, ctx, bal) {
  const full = R.can(ctx.user, 'tenant.read');
  const base = { phoneRequest: u.phoneRequest && u.phoneRequest.status === 'pending' ? { phone: u.phoneRequest.phone, at: u.phoneRequest.at } : null, id: u.id, name: u.name, phone: u.phone, unitId: u.unitId || null, propertyId: u.propertyId || null, tenancy: u.tenancy || 'current' };
  if (!full) return base;
  return { ...base, email: u.email || null, status: u.status, lastLoginAt: u.lastLoginAt || null, nationalId: u.nationalIdEnc ? sec.decField(u.nationalIdEnc) : '', emergencyContact: u.emergencyContact || '', createdAt: u.createdAt, version: u.version, balance: bal ? bal.get(u.id) || 0 : undefined };
}
function balances(ownerId) {
  const m = new Map();
  for (const i of db.invoices.byOwner(ownerId)) if (i.status === 'open') m.set(i.tenantId, D.r2((m.get(i.tenantId) || 0) + Math.max(0, i.amount - i.paid)));
  return m;
}
H.route('GET', '/api/tenants', { anyPerm: ['tenant.read', 'tenant.read.basic'] }, async (ctx) => {
  let rows = D.listScoped(db.users, ctx).filter((u) => u.role === 'tenant');
  if (ctx.query.propertyId) rows = rows.filter((u) => u.propertyId === ctx.query.propertyId);
  if (ctx.query.q) { const q = String(ctx.query.q).toLowerCase().slice(0, 50); rows = rows.filter((u) => u.name.toLowerCase().includes(q) || (u.phone || '').includes(q)); }
  if (ctx.query.current !== 'all') rows = rows.filter((u) => u.tenancy !== 'former');
  const bal = R.can(ctx.user, 'rent.read') ? balances(ctx.scope.ownerId) : null;
  const units = new Map(db.units.byOwner(ctx.scope.ownerId).map((x) => [x.id, x.name]));
  const props = new Map(D.listScoped(db.properties, ctx).map((p) => [p.id, p.name]));
  return { tenants: rows.sort((a, b) => a.name.localeCompare(b.name)).map((u) => ({ ...tenantView(u, ctx, bal), unitName: units.get(u.unitId) || '', propertyName: props.get(u.propertyId) || '' })) };
});

function leaseView(l, ctx) {
  const unit = db.units.get(l.unitId); const t = db.users.get(l.tenantId);
  const out = { ...l, unitName: unit ? unit.name : '', tenantName: t ? t.name : '', propertyName: (db.properties.get(l.propertyId) || {}).name || '' };
  if (!R.can(ctx.user, 'rent.read') && ctx.user.role !== 'tenant') { delete out.credit; }
  return out;
}

/** shared by "new tenant" and "existing tenant, new lease" */
function startLease(ctx, tenant, unit, f) {
  if (unit.status === 'occupied') throw E.conflict('That unit already has a tenant.');
  if (unit.status === 'maintenance') throw E.conflict('That unit is marked as under maintenance. Make it vacant first.');
  if (f.rent !== undefined && f.rent !== unit.rent && !R.can(ctx.user, 'lease.rent')) throw E.forbidden('Only the landlord can set a rent different from the unit\'s listed rent.');
  if (f.deposit !== undefined && f.deposit !== unit.deposit && !R.can(ctx.user, 'lease.rent')) throw E.forbidden('Only the landlord can set a deposit different from the unit\'s listed deposit.');
  const rent = f.rent ?? unit.rent; const deposit = f.deposit ?? unit.deposit;
  const lease = db.leases.insert({ ownerId: unit.ownerId, propertyId: unit.propertyId, unitId: unit.id, tenantId: tenant.id, rent, deposit, dueDay: f.dueDay || 5, startDate: f.startDate, endDate: f.endDate || null, status: 'active', credit: 0, notes: f.notes || '', createdBy: ctx.user.id, ...(f.billFrom ? { billFrom: f.billFrom } : {}) });
  db.units.update(unit.id, { status: 'occupied', tenantId: tenant.id, leaseId: lease.id, listed: false });
  db.users.update(tenant.id, { unitId: unit.id, propertyId: unit.propertyId, tenancy: 'current', leaseId: lease.id });
  if (deposit > 0 && !f.skipDepositInvoice) D.createInvoice(lease, { type: 'deposit', period: null, desc: 'Security deposit', amount: deposit, dueDate: f.startDate });
  D.generateForLease(lease);
  D.notify(tenant.id, 'Welcome home', `Your tenancy for ${unit.name} has been created. You can pay rent and report problems here.`, 'info', '#/home');
  D.audit(ctx, 'lease.created', 'lease', lease.id, { unit: unit.name, rent });
  return lease;
}
const LEASE_FIELDS = {
  unitId: { t: 'id', req: true }, startDate: { t: 'd', req: true, label: 'Move-in date' }, endDate: { t: 'd' }, rent: { t: 'n', max: 5e7, min: 1 }, deposit: { t: 'n', max: 5e7 },
  dueDay: { t: 'n', int: true, min: 1, max: 28, def: 5 }, notes: { t: 's', max: 500 },
};

/** Creates the tenant account and starts the lease in one go (used by the tenant form and by CSV import). */
async function addTenantToUnit(ctx, unit, b) {
  const { name, phone, email, nationalId, emergencyContact, ...lf } = b;
  releaseFormer(phone, email || undefined);
  const made = await D.makeUser({ role: 'tenant', ownerId: unit.ownerId, name, phone, email: email || undefined, emergencyContact: emergencyContact || '', nationalIdEnc: nationalId ? sec.encField(nationalId) : undefined, propertyId: unit.propertyId, status: 'active', createdBy: ctx.user.id });
  let lease;
  try { S.tx(() => { lease = startLease(ctx, made.user, unit, lf); }); } catch (e) { db.users.remove(made.user.id); throw e; }
  return { user: db.users.get(made.user.id), lease, tempPassword: made.tempPassword };
}
H.route('POST', '/api/tenants', { perm: 'tenant.write', rate: [60, 60000] }, async (ctx) => {
  D.need(ctx, 'lease.write');
  P.assertCanGrow(ctx.scope.ownerId);
  const b = clean(ctx.body, {
    name: { t: 's', req: true, max: 80, min: 2 }, phone: { t: 'phone', req: true }, email: { t: 'email' }, nationalId: { t: 's', max: 20, re: NID_RE, label: 'ID number' },
    emergencyContact: { t: 's', max: 120 }, ...LEASE_FIELDS,
  });
  const unit = D.getScoped(db.units, b.unitId, ctx);
  if (b.endDate && b.endDate <= b.startDate) throw E.bad('Lease end date must be after the move-in date');
  const { unitId, ...rest } = b;
  const made = await addTenantToUnit(ctx, unit, rest);
  return { tenant: tenantView(made.user, ctx), lease: leaseView(made.lease, ctx), tempPassword: made.tempPassword };
});
H.route('POST', '/api/leases', { perm: 'lease.write' }, async (ctx) => {
  const b = clean(ctx.body, { tenantId: { t: 'id', req: true }, ...LEASE_FIELDS });
  const tenant = D.getScoped(db.users, b.tenantId, ctx);
  if (tenant.role !== 'tenant') throw E.notFound();
  if (db.leases.where('tenantId', tenant.id).some((l) => l.status === 'active')) throw E.conflict('This tenant already has an active lease. End it first.');
  const unit = D.getScoped(db.units, b.unitId, ctx);
  if (b.endDate && b.endDate <= b.startDate) throw E.bad('Lease end date must be after the move-in date');
  const { tenantId, unitId, ...lf } = b;
  let lease; S.tx(() => { lease = startLease(ctx, tenant, unit, lf); });
  return { lease: leaseView(lease, ctx) };
});

H.route('GET', '/api/tenants/:id', { perm: 'tenant.read' }, async (ctx) => {
  const t = D.getScoped(db.users, ctx.params.id, ctx);
  if (t.role !== 'tenant') throw E.notFound();
  const leases = db.leases.where('tenantId', t.id).sort((a, b) => b.createdAt - a.createdAt).map((l) => leaseView(l, ctx));
  const out = { tenant: { ...tenantView(t, ctx), unitName: (db.units.get(t.unitId) || {}).name || '' }, leases };
  if (R.can(ctx.user, 'rent.read')) {
    out.invoices = db.invoices.byOwner(t.ownerId).filter((i) => i.tenantId === t.id).map((i) => D.invView(i)).sort((a, b) => b.dueDate.localeCompare(a.dueDate));
    out.payments = db.payments.byOwner(t.ownerId).filter((p) => p.tenantId === t.id).sort((a, b) => b.createdAt - a.createdAt);
    out.balance = D.tenantBalance(t.id, t.ownerId);
  }
  return out;
});
H.route('PUT', '/api/tenants/:id', { perm: 'tenant.write' }, async (ctx) => {
  const t = D.getScoped(db.users, ctx.params.id, ctx);
  if (t.role !== 'tenant') throw E.notFound();
  const b = clean(ctx.body, { name: { t: 's', req: true, max: 80, min: 2 }, phone: { t: 'phone', req: true }, email: { t: 'email' }, nationalId: { t: 's', max: 20, re: NID_RE }, emergencyContact: { t: 's', max: 120 }, version: { t: 'n', req: true, int: true } });
  const { version, nationalId, email, ...patch } = b;
  releaseFormer(patch.phone !== t.phone ? patch.phone : null, email && email !== t.email ? email : null, t.id);
  patch.email = email || undefined; if (nationalId) patch.nationalIdEnc = sec.encField(nationalId);
  const up = db.users.update(t.id, patch, version);
  D.audit(ctx, 'tenant.updated', 'user', t.id, { fields: Object.keys(patch) });
  return { tenant: tenantView(up, ctx) };
});
H.route('POST', '/api/tenants/:id/phone-request', { perm: 'tenant.write', rate: [30, 60000] }, async (ctx) => {
  const t = D.getScoped(db.users, ctx.params.id, ctx);
  if (t.role !== 'tenant' || !t.phoneRequest || t.phoneRequest.status !== 'pending') throw E.notFound();
  const b = clean(ctx.body, { accept: { t: 'b', req: true } });
  if (b.accept) {
    releaseFormer(t.phoneRequest.phone, null, t.id);
    const old = t.phone;
    db.users.update(t.id, { phone: t.phoneRequest.phone, phoneRequest: null, phoneChangedAt: Date.now() });
    D.notify(t.id, 'Phone number changed', 'Your new phone number is now active. Use it to sign in.', 'info', '#/account');
    D.smsTo(t.ownerId, old, 'Your Jasmyle Properties phone number was changed. If this was not you, contact your landlord at once.');
  } else { db.users.update(t.id, { phoneRequest: null }); D.notify(t.id, 'Phone change declined', 'Your landlord did not approve the new number. Please contact them.', 'info', '#/account'); }
  D.audit(ctx, b.accept ? 'tenant.phone_change_approved' : 'tenant.phone_change_declined', 'user', t.id, {});
  return { tenant: tenantView(db.users.get(t.id), ctx) };
});
H.route('POST', '/api/tenants/:id/reset-password', { perm: 'tenant.write', rate: [10, 60000] }, async (ctx) => {
  const t = D.getScoped(db.users, ctx.params.id, ctx);
  if (t.role !== 'tenant') throw E.notFound();
  const temp = sec.genPassword();
  db.users.update(t.id, { passHash: await sec.hashPassword(temp), mustChangePassword: true, failed: 0, lockedUntil: 0 });
  A.killSessions(t.id);
  D.audit(ctx, 'tenant.password_reset', 'user', t.id);
  return { tempPassword: temp };
});

H.route('GET', '/api/leases', { perm: 'lease.read' }, async (ctx) => {
  let rows = D.listScoped(db.leases, ctx);
  if (ctx.query.status) rows = rows.filter((l) => l.status === ctx.query.status);
  if (ctx.query.propertyId) rows = rows.filter((l) => l.propertyId === ctx.query.propertyId);
  const files = new Map(); for (const f of D.listScoped(db.files, ctx).filter((f) => f.refType === 'lease')) files.set(f.refId, f);
  return { leases: rows.sort((a, b) => b.createdAt - a.createdAt).map((l) => ({ ...leaseView(l, ctx), document: files.has(l.id) ? { id: files.get(l.id).id, name: files.get(l.id).name } : null })) };
});
H.route('PUT', '/api/leases/:id', { perm: 'lease.write' }, async (ctx) => {
  const l = D.getScoped(db.leases, ctx.params.id, ctx);
  if (l.status !== 'active') throw E.conflict('This lease has ended.');
  const canRent = R.can(ctx.user, 'lease.rent');
  const b = clean(ctx.body, { endDate: { t: 'd' }, dueDay: { t: 'n', int: true, min: 1, max: 28 }, notes: { t: 's', max: 500 }, rent: { t: 'n', min: 1, max: 5e7 }, deposit: { t: 'n', max: 5e7 }, version: { t: 'n', req: true, int: true } });
  const { version, ...patch } = b;
  if ((patch.rent !== undefined && patch.rent !== l.rent) || (patch.deposit !== undefined && patch.deposit !== l.deposit)) {
    if (!canRent) throw E.forbidden('Only the landlord can change the rent or deposit.');
  } else { delete patch.rent; delete patch.deposit; }
  if (patch.endDate && patch.endDate <= l.startDate) throw E.bad('Lease end date must be after the move-in date');
  const up = db.leases.update(l.id, patch, version);
  if (patch.rent !== undefined) D.notify(l.tenantId, 'Rent updated', `Your monthly rent is now ${D.fmtMoney(patch.rent)} from next month's invoice.`, 'info', '#/home');
  D.audit(ctx, 'lease.updated', 'lease', l.id, { ...patch, oldRent: l.rent });
  return { lease: leaseView(up, ctx) };
});
H.route('POST', '/api/leases/:id/terminate', { perm: 'lease.terminate' }, async (ctx) => {
  const l = D.getScoped(db.leases, ctx.params.id, ctx);
  if (l.status !== 'active') throw E.conflict('This lease has already ended.');
  const b = clean(ctx.body, { endDate: { t: 'd', req: true, label: 'Move-out date' }, note: { t: 's', max: 500 }, depositRefunded: { t: 'n', max: 5e7, def: 0 } });
  S.tx(() => {
    db.leases.update(l.id, { status: 'ended', endedAt: Date.now(), endDate: b.endDate, moveOutNote: b.note || '', depositRefunded: b.depositRefunded });
    db.units.update(l.unitId, { status: 'vacant', tenantId: null, leaseId: null, vacantSince: b.endDate });
    db.users.update(l.tenantId, { unitId: null, tenancy: 'former' });
    D.audit(ctx, 'lease.terminated', 'lease', l.id, { endDate: b.endDate, depositRefunded: b.depositRefunded });
  });
  const open = D.leaseBalance(l.id);
  return { ok: true, outstanding: open };
});

/* ======================= STAFF (landlord creates managers, caretakers, contractors) ======================= */
const staffView = (u) => ({ id: u.id, name: u.name, role: u.role, email: u.email || null, phone: u.phone || null, status: u.status, assignedPropertyIds: u.assignedPropertyIds || [], approvalLimit: u.approvalLimit ?? null, contractorId: u.contractorId || null, lastLoginAt: u.lastLoginAt || null, mfaEnabled: !!(u.totp && u.totp.enabled), version: u.version });
H.route('GET', '/api/staff', { perm: 'staff.manage' }, async (ctx) => ({ staff: db.users.byOwner(ctx.scope.ownerId).filter((u) => R.ORG_STAFF.includes(u.role)).map(staffView).sort((a, b) => a.name.localeCompare(b.name)) }));
H.route('POST', '/api/staff', { perm: 'staff.manage', rate: [30, 60000] }, async (ctx) => {
  const b = clean(ctx.body, {
    role: { t: 'e', values: R.ORG_STAFF, req: true }, name: { t: 's', req: true, max: 80, min: 2 }, phone: { t: 'phone', req: true }, email: { t: 'email' },
    assignedPropertyIds: { t: 'ids', max: 2000 }, approvalLimit: { t: 'n', max: 1e8, def: 20000 }, contractorId: { t: 'id' },
  });
  const props = D.requirePropertyIds(ctx, b.assignedPropertyIds || []);
  if (['property_manager', 'caretaker'].includes(b.role) && !props.length) throw E.bad('Choose at least one property for this person to work on. They cannot see any other property.');
  if (b.role === 'contractor') {
    const c = db.contractors.get(b.contractorId);
    if (!c || c.ownerId !== ctx.scope.ownerId) throw E.bad('Choose the contractor / team this login belongs to');
  }
  const fields = { role: b.role, ownerId: ctx.scope.ownerId, name: b.name, phone: b.phone, email: b.email || undefined, status: 'active', createdBy: ctx.user.id };
  if (b.role !== 'contractor') fields.assignedPropertyIds = props;
  if (b.role === 'property_manager') fields.approvalLimit = b.approvalLimit;
  if (b.role === 'contractor') fields.contractorId = b.contractorId;
  const { user, tempPassword } = await D.makeUser(fields);
  D.audit(ctx, 'staff.created', 'user', user.id, { role: user.role, name: user.name, properties: props.length });
  return { staff: staffView(user), tempPassword };
});
H.route('PUT', '/api/staff/:id', { perm: 'staff.manage' }, async (ctx) => {
  const u = db.users.get(ctx.params.id);
  if (!u || u.ownerId !== ctx.scope.ownerId || !R.ORG_STAFF.includes(u.role)) throw E.notFound();
  const b = clean(ctx.body, { name: { t: 's', max: 80, min: 2 }, phone: { t: 'phone' }, email: { t: 'email' }, assignedPropertyIds: { t: 'ids', max: 2000 }, approvalLimit: { t: 'n', max: 1e8 }, status: { t: 'e', values: ['active', 'suspended'] }, version: { t: 'n', req: true, int: true } });
  const { version, ...patch } = b;
  if (patch.assignedPropertyIds) { patch.assignedPropertyIds = D.requirePropertyIds(ctx, patch.assignedPropertyIds); if (u.role !== 'contractor' && !patch.assignedPropertyIds.length) throw E.bad('Choose at least one property'); }
  if (u.role !== 'property_manager') delete patch.approvalLimit;
  if (u.role === 'contractor') delete patch.assignedPropertyIds;
  const up = db.users.update(u.id, patch, version);
  if (patch.status === 'suspended') A.killSessions(u.id);
  D.audit(ctx, 'staff.updated', 'user', u.id, { fields: Object.keys(patch), properties: patch.assignedPropertyIds ? patch.assignedPropertyIds.length : undefined });
  return { staff: staffView(up) };
});
H.route('POST', '/api/staff/:id/reset-password', { perm: 'staff.manage', rate: [10, 60000] }, async (ctx) => {
  const u = db.users.get(ctx.params.id);
  if (!u || u.ownerId !== ctx.scope.ownerId || !R.ORG_STAFF.includes(u.role)) throw E.notFound();
  const temp = sec.genPassword();
  db.users.update(u.id, { passHash: await sec.hashPassword(temp), mustChangePassword: true, failed: 0, lockedUntil: 0 });
  A.killSessions(u.id);
  D.audit(ctx, 'staff.password_reset', 'user', u.id);
  return { tempPassword: temp };
});

/* ======================= SETTINGS (payment gateways, SMS, bank) ======================= */
const MASK = '••••••••';
function settingsView(s) {
  const url = D.publicUrl();
  return {
    mode: s.mode, orgName: s.orgName, reminderDays: s.reminderDays, invoiceLeadDays: s.invoiceLeadDays, usdRate: s.usdRate, overdueRepeatDays: s.overdueRepeatDays, version: s.version,
    mpesa: { enabled: s.mpesa.enabled, env: s.mpesa.env, type: s.mpesa.type, shortcode: s.mpesa.shortcode, partyB: s.mpesa.partyB, consumerKey: s.mpesa.consumerKeyEnc ? MASK : '', consumerSecret: s.mpesa.consumerSecretEnc ? MASK : '', passkey: s.mpesa.passkeyEnc ? MASK : '' },
    paypal: { enabled: s.paypal.enabled, mode: s.paypal.mode, clientId: s.paypal.clientIdEnc ? MASK : '', secret: s.paypal.secretEnc ? MASK : '' },
    bank: s.bank, sms: { enabled: s.sms.enabled, username: s.sms.username, senderId: s.sms.senderId, apiKey: s.sms.apiKeyEnc ? MASK : '' },
    publicUrl: url, callbackUrlExample: url ? url + '/api/pay/mpesa/callback/…' : '(set the public https address first - ask National Administration or see the setup guide)',
    publicUrlReady: /^https:\/\//.test(url),
  };
}
H.route('GET', '/api/settings', { perm: 'settings.payments' }, async (ctx) => ({ settings: settingsView(D.ensureSettings(ctx.scope.ownerId)) }));
const secret = (v, old) => (v === undefined || v === '' || v === MASK ? old : sec.encField(v));
H.route('PUT', '/api/settings', { perm: 'settings.payments' }, async (ctx) => {
  const b = ctx.body || {};
  const g = clean(b, {
    mode: { t: 'e', values: ['simulate', 'live'], req: true }, orgName: { t: 's', max: 100 }, reminderDays: { t: 'n', int: true, min: 0, max: 14, def: 3 }, invoiceLeadDays: { t: 'n', int: true, min: 0, max: 20, def: 5 },
    usdRate: { t: 'n', min: 1, max: 1000, def: 129 }, overdueRepeatDays: { t: 'n', int: true, min: 1, max: 30, def: 7 },
  });
  const m = clean(b.mpesa || {}, { enabled: { t: 'b' }, env: { t: 'e', values: ['sandbox', 'production'], def: 'sandbox' }, type: { t: 'e', values: ['paybill', 'till'], def: 'paybill' }, shortcode: { t: 's', max: 12, re: /^\d*$/ }, partyB: { t: 's', max: 12, re: /^\d*$/ }, consumerKey: { t: 's', max: 200, raw: true }, consumerSecret: { t: 's', max: 200, raw: true }, passkey: { t: 's', max: 300, raw: true } });
  const p = clean(b.paypal || {}, { enabled: { t: 'b' }, mode: { t: 'e', values: ['sandbox', 'live'], def: 'sandbox' }, clientId: { t: 's', max: 200, raw: true }, secret: { t: 's', max: 300, raw: true } });
  const k = clean(b.bank || {}, { enabled: { t: 'b' }, bankName: { t: 's', max: 80 }, accountName: { t: 's', max: 100 }, accountNo: { t: 's', max: 40 }, branch: { t: 's', max: 80 }, instructions: { t: 's', max: 400 } });
  const sm = clean(b.sms || {}, { enabled: { t: 'b' }, username: { t: 's', max: 60 }, senderId: { t: 's', max: 11 }, apiKey: { t: 's', max: 200, raw: true } });
  const cur = D.ensureSettings(ctx.scope.ownerId);
  if (Number.isInteger(b.version) && b.version !== cur.version) throw E.conflict('Settings were changed by someone else. Reload and try again.', 'version_conflict');
  if (g.mode === 'live' && !(/^https:\/\//.test(D.publicUrl()))) throw E.bad('Live mode needs a public https address so M-Pesa and PayPal can reach this system. Follow the "Access from anywhere" section of the setup guide, then ask National Administration to save the address.');
  if (g.mode === 'live' && !(m.enabled || p.enabled || k.enabled)) throw E.bad('Enable at least one payment method before going live.');
  const up = db.settings.update(cur.id, (s) => {
    Object.assign(s, g);
    s.mpesa = { enabled: !!m.enabled, env: m.env, type: m.type, shortcode: m.shortcode || '', partyB: m.partyB || '', consumerKeyEnc: secret(m.consumerKey, s.mpesa.consumerKeyEnc), consumerSecretEnc: secret(m.consumerSecret, s.mpesa.consumerSecretEnc), passkeyEnc: secret(m.passkey, s.mpesa.passkeyEnc) };
    s.paypal = { enabled: !!p.enabled, mode: p.mode, clientIdEnc: secret(p.clientId, s.paypal.clientIdEnc), secretEnc: secret(p.secret, s.paypal.secretEnc) };
    s.bank = { enabled: !!k.enabled, bankName: k.bankName || '', accountName: k.accountName || '', accountNo: k.accountNo || '', branch: k.branch || '', instructions: k.instructions || '' };
    s.sms = { enabled: !!sm.enabled, username: sm.username || '', senderId: sm.senderId || '', apiKeyEnc: secret(sm.apiKey, s.sms.apiKeyEnc) };
    return s;
  });
  D.audit(ctx, 'settings.updated', 'settings', up.id, { mode: g.mode, mpesa: !!m.enabled, paypal: !!p.enabled, bank: !!k.enabled, sms: !!sm.enabled });
  return { settings: settingsView(up) };
});
H.route('POST', '/api/settings/test-mpesa', { perm: 'settings.payments', rate: [6, 60000] }, async (ctx) => {
  const s = D.ensureSettings(ctx.scope.ownerId);
  if (!gw.mpesaReady({ ...s.mpesa, enabled: true })) throw E.bad('Save the M-Pesa shortcode, key, secret and passkey first.');
  await gw.mpesaToken(s.mpesa);
  return { ok: true, message: 'Connected to M-Pesa successfully.' };
});
H.route('POST', '/api/settings/test-paypal', { perm: 'settings.payments', rate: [6, 60000] }, async (ctx) => {
  const s = D.ensureSettings(ctx.scope.ownerId);
  if (!gw.paypalReady({ ...s.paypal, enabled: true })) throw E.bad('Save the PayPal Client ID and Secret first.');
  await gw.ppToken(s.paypal);
  return { ok: true, message: 'Connected to PayPal successfully.' };
});

/* ======================= ORGANISATION AUDIT TRAIL ======================= */
H.route('GET', '/api/audit', { perm: 'audit.read' }, async (ctx) => {
  const rows = S.audit.list({ owner: ctx.scope.ownerId, actor: ctx.query.actor || undefined, action: ctx.query.action || undefined, before: ctx.query.before, limit: 200 });
  const names = {};
  for (const r of rows) if (r.actor && !(r.actor in names)) { const u = db.users.get(r.actor); names[r.actor] = u ? u.name : null; }
  return { events: rows.map((r) => ({ ...r, actorName: names[r.actor] || 'System' })) };
});

/* ======================= ROLES PAGE (visible to everyone: transparency) ======================= */
H.route('GET', '/api/roles', {}, async (ctx) => ({
  roles: Object.entries(R.ROLES).map(([key, r]) => ({ key, label: r.label, blurb: r.blurb, can: r.can, cannot: r.cannot, scope: r.scope, perms: r.perms.map((p) => ({ key: p, label: R.PERMS[p] })) })),
  you: ctx.user.role,
}));

module.exports = { releaseFormer, tenantView, leaseView, staffView, addTenantToUnit, startLease, UNIT_TYPES, UNIT_FIELDS, LEASE_FIELDS, NID_RE, AMEN };
