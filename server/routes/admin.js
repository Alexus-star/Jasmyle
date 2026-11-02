'use strict';
// NATIONAL ADMINISTRATION. Account-level and aggregate information only - this file never reads
// tenants' leases, invoices, payments, expenses, messages or maintenance records.
const fs = require('fs');
const S = require('../store');
const { db } = S;
const U = require('../util');
const { E, clean } = U;
const sec = require('../sec');
const cfg = require('../config');
const H = require('../http');
const D = require('../domain');
const A = require('./auth');

const landlordRow = (u) => {
  const props = db.properties.byOwner(u.id).filter((p) => p.status !== 'archived');
  const units = db.units.byOwner(u.id).filter((x) => !x.archived);
  return {
    id: u.id, name: u.name, company: u.company || '', email: u.email, phone: u.phone, county: u.county || '', town: u.town || '', status: u.status,
    createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null, mfaEnabled: !!(u.totp && u.totp.enabled), selfRegistered: !!u.selfRegistered,
    properties: props.length, verifiedProperties: props.filter((p) => p.verified).length, units: units.length, occupied: units.filter((x) => x.status === 'occupied').length,
  };
};

H.route('GET', '/api/admin/stats', { perm: 'platform.stats' }, async () => {
  const landlords = db.users.where('role', 'landlord');
  const props = db.properties.all().filter((p) => p.status !== 'archived');
  const units = db.units.all().filter((x) => !x.archived);
  const tenants = db.users.where('role', 'tenant').filter((t) => t.status === 'active');
  const byCounty = {};
  for (const p of props) {
    const c = p.county || 'Unspecified';
    const row = byCounty[c] || (byCounty[c] = { county: c, properties: 0, units: 0, occupied: 0 });
    row.properties++;
  }
  for (const x of units) {
    const p = props.find((q) => q.id === x.propertyId); if (!p) continue;
    const row = byCounty[p.county || 'Unspecified']; row.units++; if (x.status === 'occupied') row.occupied++;
  }
  const pendingLandlords = landlords.filter((l) => l.status === 'pending');
  return {
    landlords: { total: landlords.length, active: landlords.filter((l) => l.status === 'active').length, pending: pendingLandlords.length, suspended: landlords.filter((l) => l.status === 'suspended').length },
    properties: { total: props.length, verified: props.filter((p) => p.verified).length, unverified: props.filter((p) => !p.verified).length, suspended: props.filter((p) => p.status === 'suspended').length },
    units: { total: units.length, occupied: units.filter((x) => x.status === 'occupied').length, vacant: units.filter((x) => x.status === 'vacant').length },
    tenants: tenants.length,
    occupancyRate: units.length ? Math.round((units.filter((x) => x.status === 'occupied').length / units.length) * 100) : 0,
    byCounty: Object.values(byCounty).sort((a, b) => b.units - a.units),
    pendingLandlords: pendingLandlords.map(landlordRow),
  };
});

/* ----- landlords ----- */
H.route('GET', '/api/admin/landlords', { perm: 'platform.landlords' }, async () => ({ landlords: db.users.where('role', 'landlord').map(landlordRow).sort((a, b) => b.createdAt - a.createdAt) }));

H.route('POST', '/api/admin/landlords', { perm: 'platform.landlords' }, async (ctx) => {
  const b = clean(ctx.body, { name: { t: 's', req: true, max: 80, min: 2 }, company: { t: 's', max: 100 }, email: { t: 'email', req: true }, phone: { t: 'phone', req: true }, county: { t: 's', max: 40 }, town: { t: 's', max: 60 } });
  const { user, tempPassword } = await D.makeUser({ ...b, role: 'landlord', status: 'active', createdBy: ctx.user.id });
  D.ensureSettings(user.id);
  D.audit(ctx, 'admin.landlord_created', 'user', user.id, { name: user.name });
  return { landlord: landlordRow(user), tempPassword };
});

H.route('POST', '/api/admin/landlords/:id/status', { perm: 'platform.landlords' }, async (ctx) => {
  const b = clean(ctx.body, { status: { t: 'e', values: ['active', 'suspended'], req: true }, reason: { t: 's', max: 300 } });
  const u = db.users.get(ctx.params.id);
  if (!u || u.role !== 'landlord') throw E.notFound();
  const wasPending = u.status === 'pending';
  S.tx(() => {
    db.users.update(u.id, { status: b.status, ...(b.status === 'active' && !u.approvedAt ? { approvedAt: Date.now() } : {}) });
    if (b.status === 'suspended') { // suspending a landlord switches off their whole organisation
      for (const m of db.users.byOwner(u.id)) A.killSessions(m.id);
      for (const p of db.properties.byOwner(u.id)) if (p.status === 'active') db.properties.update(p.id, { suspendedByOwner: true });
    } else if (wasPending) D.ensureSettings(u.id);
    D.audit(ctx, wasPending && b.status === 'active' ? 'admin.landlord_approved' : 'admin.landlord_status', 'user', u.id, { status: b.status, reason: b.reason || null });
  });
  return { landlord: landlordRow(db.users.get(u.id)) };
});

H.route('POST', '/api/admin/landlords/:id/reset-password', { perm: 'platform.landlords', rate: [10, 60000] }, async (ctx) => {
  const b = clean(ctx.body, { resetMfa: { t: 'b' } });
  const u = db.users.get(ctx.params.id);
  if (!u || u.role !== 'landlord') throw E.notFound();
  const temp = sec.genPassword();
  const patch = { passHash: await sec.hashPassword(temp), mustChangePassword: true, failed: 0, lockedUntil: 0 };
  if (b.resetMfa) { patch.totp = null; patch.recovery = []; }
  db.users.update(u.id, patch);
  A.killSessions(u.id);
  D.audit(ctx, 'admin.landlord_password_reset', 'user', u.id, { resetMfa: !!b.resetMfa });
  return { tempPassword: temp };
});

/* ----- property verification ----- */
H.route('GET', '/api/admin/properties', { perm: 'platform.properties' }, async () => {
  const owners = {};
  const rows = db.properties.all().filter((p) => p.status !== 'archived').map((p) => {
    const o = owners[p.ownerId] || (owners[p.ownerId] = db.users.get(p.ownerId));
    const units = db.units.byProp(p.id).filter((x) => !x.archived);
    return {
      id: p.id, name: p.name, county: p.county || '', town: p.town || '', address: p.address || '', verified: !!p.verified, verifiedAt: p.verifiedAt || null, status: p.status,
      landlord: o ? { id: o.id, name: o.name, company: o.company || '' } : null, units: units.length, occupied: units.filter((x) => x.status === 'occupied').length, createdAt: p.createdAt, verifyNote: p.verifyNote || '',
    };
  });
  return { properties: rows.sort((a, b) => Number(a.verified) - Number(b.verified) || b.createdAt - a.createdAt) };
});
H.route('POST', '/api/admin/properties/:id/verify', { perm: 'platform.properties' }, async (ctx) => {
  const b = clean(ctx.body, { verified: { t: 'b', req: true }, note: { t: 's', max: 300 } });
  const p = db.properties.get(ctx.params.id);
  if (!p) throw E.notFound();
  db.properties.update(p.id, { verified: b.verified, verifiedAt: b.verified ? Date.now() : null, verifiedBy: ctx.user.id, verifyNote: b.note || '' });
  D.notify(p.ownerId, b.verified ? 'Property verified' : 'Property verification removed', `${p.name}${b.note ? ': ' + b.note : ''}`, 'admin', '#/properties');
  D.audit(ctx, b.verified ? 'admin.property_verified' : 'admin.property_unverified', 'property', p.id, { name: p.name });
  return { ok: true };
});
H.route('POST', '/api/admin/properties/:id/suspend', { perm: 'platform.properties' }, async (ctx) => {
  const b = clean(ctx.body, { suspended: { t: 'b', req: true }, note: { t: 's', max: 300 } });
  const p = db.properties.get(ctx.params.id);
  if (!p) throw E.notFound();
  db.properties.update(p.id, { status: b.suspended ? 'suspended' : 'active', verified: b.suspended ? false : p.verified });
  D.notify(p.ownerId, b.suspended ? 'Listing suspended' : 'Listing restored', `${p.name}${b.note ? ': ' + b.note : ''}`, 'admin', '#/properties');
  D.audit(ctx, 'admin.property_' + (b.suspended ? 'suspended' : 'restored'), 'property', p.id, { note: b.note || null });
  return { ok: true };
});

/* ----- other national administrators (super administrator only) ----- */
H.route('GET', '/api/admin/admins', { perm: 'platform.admins' }, async () => ({
  admins: db.users.where('role', 'national_admin').map((u) => ({ id: u.id, name: u.name, email: u.email, status: u.status, isSuper: !!u.isSuper, mfaEnabled: !!(u.totp && u.totp.enabled), lastLoginAt: u.lastLoginAt || null })),
}));
H.route('POST', '/api/admin/admins', { perm: 'platform.admins' }, async (ctx) => {
  if (!ctx.user.isSuper) throw E.forbidden('Only the super administrator can add administrators.');
  const b = clean(ctx.body, { name: { t: 's', req: true, max: 80, min: 2 }, email: { t: 'email', req: true } });
  const { user, tempPassword } = await D.makeUser({ ...b, role: 'national_admin', ownerId: null, isSuper: false, createdBy: ctx.user.id });
  D.audit(ctx, 'admin.admin_created', 'user', user.id, { email: user.email });
  return { admin: { id: user.id, name: user.name, email: user.email }, tempPassword };
});
H.route('POST', '/api/admin/admins/:id/status', { perm: 'platform.admins' }, async (ctx) => {
  if (!ctx.user.isSuper) throw E.forbidden('Only the super administrator can do this.');
  const b = clean(ctx.body, { status: { t: 'e', values: ['active', 'suspended'], req: true } });
  const u = db.users.get(ctx.params.id);
  if (!u || u.role !== 'national_admin') throw E.notFound();
  if (u.isSuper) throw E.forbidden('The super administrator cannot be disabled.');
  db.users.update(u.id, { status: b.status });
  if (b.status !== 'active') A.killSessions(u.id);
  D.audit(ctx, 'admin.admin_status', 'user', u.id, { status: b.status });
  return { ok: true };
});

/* ----- audit, backups, settings ----- */
H.route('GET', '/api/admin/audit', { perm: 'platform.audit' }, async (ctx) => {
  const before = ctx.query.before;
  // Platform audit shows account/security events only - never business events inside a landlord's organisation.
  const rows = ['auth.', 'admin.', 'account.', 'security.'].flatMap((p) => S.audit.list({ action: p, before, limit: 150 }))
    .sort((a, b) => b.seq - a.seq).slice(0, 150);
  const names = {};
  for (const r of rows) if (r.actor && !(r.actor in names)) { const u = db.users.get(r.actor); names[r.actor] = u ? u.name : null; }
  return { events: rows.map((r) => ({ ...r, actorName: names[r.actor] || null })) };
});
H.route('GET', '/api/admin/audit/verify', { perm: 'platform.audit' }, async () => S.audit.verify());
H.route('GET', '/api/admin/system', { perm: 'platform.settings' }, async () => {
  let dbSize = 0; try { dbSize = fs.statSync(cfg.paths.db).size; } catch { /* ignore */ }
  return {
    version: '1.0.0', node: process.version, platform: process.platform, uptimeSeconds: Math.round(process.uptime()), dbSize,
    publicUrl: D.publicUrl(), backups: S.listBackups().slice(0, 10), lastJobRun: S.meta.get('jobs:last'), restarts: S.meta.get('boot:count', 0),
    adminIpAllowlist: cfg.adminIpAllowlist, timezone: cfg.timezone,
  };
});
H.route('POST', '/api/admin/backup', { perm: 'platform.settings', rate: [6, 60000] }, async (ctx) => {
  const f = S.backup('manual');
  D.audit(ctx, 'admin.backup_created', 'platform', null);
  return { file: require('path').basename(f) };
});
H.route('PUT', '/api/admin/settings', { perm: 'platform.settings' }, async (ctx) => {
  const b = clean(ctx.body, { publicUrl: { t: 's', max: 200, req: true } });
  let u = b.publicUrl.replace(/\/+$/, '');
  if (u && !/^https:\/\/[A-Za-z0-9.-]+(:\d+)?$/.test(u)) throw E.bad('The public address must start with https:// and have no path, for example https://rent.example.com');
  S.meta.set('publicUrl', u);
  D.audit(ctx, 'admin.public_url_set', 'platform', null, { publicUrl: u });
  return { publicUrl: u };
});

module.exports = {};
