'use strict';
// DATA PROTECTION: legal pages, consent records, the Privacy centre (data export, data-subject requests), and the administrator's
// tools for answering those requests. Follows the Kenya Data Protection Act, 2019 (rights in s.26, portability s.38, breach notice s.43).
const S = require('../store');
const { db } = S;
const U = require('../util');
const { E, clean } = U;
const H = require('../http');
const D = require('../domain');
const P = require('../platform');
const L = require('../legal');

H.route('GET', '/api/public/legal', { public: true, rate: [60, 60000] }, async () => {
  const c = L.ctl();
  return { version: L.VERSION, effective: L.EFFECTIVE, about: L.about(), terms: L.terms(), privacy: L.privacy(), controller: { name: c.name, address: c.address, email: c.email, phone: c.phone, dpo: c.dpo, dpoEmail: c.dpoEmail, odpc: c.odpc } };
});

/* ---------- consent records ---------- */
function recordConsent(ctx, user, purpose, extra = {}) {
  return db.consents.insert({ userId: user ? user.id : null, subject: user ? (user.email || user.phone) : (extra.subject || null), purpose, legalVersion: L.VERSION, ip: ctx.ip, ua: String(ctx.req.headers['user-agent'] || '').slice(0, 160), ...extra });
}
H.route('POST', '/api/me/accept-legal', { skipGate: true, rate: [30, 3600000] }, async (ctx) => {
  const b = clean(ctx.body, { version: { t: 's', req: true, max: 20 }, accept: { t: 'b', req: true } });
  if (!b.accept || b.version !== L.VERSION) throw E.bad('Please accept the current Terms and Privacy Notice to continue.');
  db.users.update(ctx.user.id, { legalVersion: L.VERSION, legalAcceptedAt: Date.now() });
  recordConsent(ctx, ctx.user, 'terms_and_privacy');
  D.audit(ctx, 'privacy.terms_accepted', 'user', ctx.user.id, { version: L.VERSION });
  return { ok: true };
});

/* ---------- data export (right of access and portability) ---------- */
const SECRET = new Set(['passHash', 'totp', 'recoveryCodes', 'passportLinks', 'tokenHash']);
const safe = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !SECRET.has(k) && !/Enc$/.test(k)));
function exportFor(user) {
  const out = { exportedAt: new Date().toISOString(), notice: 'Copy of the personal data Jasmyle Properties holds about you, in a structured, machine-readable format (Data Protection Act, 2019, sections 26 and 38).', profile: safe(user), consents: db.consents.where('userId', user.id), requests: db.dsr.where('userId', user.id), notifications: db.notifications.where('userId', user.id).slice(-200).map(safe) };
  if (user.role === 'tenant') {
    out.leases = db.leases.where('tenantId', user.id).map(safe); out.invoices = db.invoices.where('tenantId', user.id).map(safe); out.payments = db.payments.where('tenantId', user.id).map((p) => { const { tokenHash, checkoutRequestId, ...x } = safe(p); return x; });
    out.maintenanceRequests = db.maintenance.where('tenantId', user.id).map(safe);
    out.messages = db.messages.all().filter((m) => m.fromId === user.id || m.toId === user.id).map(safe);
  } else if (user.role === 'landlord') {
    out.properties = db.properties.byOwner(user.id).map(safe); out.units = db.units.byOwner(user.id).map(safe); out.platformInvoices = db.plat_invoices.byOwner(user.id).map(safe);
    out.note = 'Tenant records you entered belong to your tenants as data subjects; they are not included here but can be exported from each module.';
  } else out.messages = db.messages.all().filter((m) => m.fromId === user.id || m.toId === user.id).map(safe);
  return out;
}
H.route('GET', '/api/me/export', { skipGate: true, rate: [6, 3600000] }, async (ctx) => {
  const body = Buffer.from(JSON.stringify(exportFor(ctx.user), null, 2));
  D.audit(ctx, 'privacy.export', 'user', ctx.user.id, {});
  ctx.send(200, body, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="my-jasmyle-data.json"', 'Cache-Control': 'no-store' });
});

/* ---------- data-subject requests ---------- */
const KINDS = ['access', 'rectification', 'erasure', 'objection', 'restriction', 'portability', 'withdraw_consent'];
H.route('GET', '/api/me/privacy', { skipGate: true }, async (ctx) => ({
  version: L.VERSION, accepted: ctx.user.legalVersion === L.VERSION, acceptedAt: ctx.user.legalAcceptedAt || null, kinds: KINDS,
  consents: db.consents.where('userId', ctx.user.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 50).map((c) => ({ purpose: c.purpose, version: c.legalVersion, at: c.createdAt })),
  requests: db.dsr.where('userId', ctx.user.id).sort((a, b) => b.createdAt - a.createdAt).map((r) => ({ id: r.id, kind: r.kind, status: r.status, note: r.note, response: r.response || '', createdAt: r.createdAt, dueBy: r.dueBy })),
}));
const DUE_DAYS = 30;
H.route('POST', '/api/me/data-request', { rate: [6, 3600000], skipGate: true }, async (ctx) => {
  const b = clean(ctx.body, { kind: { t: 'e', values: KINDS, req: true }, note: { t: 's', max: 500 } });
  if (db.dsr.where('userId', ctx.user.id).some((r) => r.kind === b.kind && ['new', 'in_progress'].includes(r.status))) throw E.conflict('You already have an open request of this kind. We will reply soon.');
  const r = db.dsr.insert({ userId: ctx.user.id, subjectName: ctx.user.name, subjectContact: ctx.user.email || ctx.user.phone, role: ctx.user.role, ownerId: ctx.user.ownerId || null, kind: b.kind, note: b.note || '', status: 'new', dueBy: Date.now() + DUE_DAYS * 864e5 });
  for (const a of db.users.where('role', 'national_admin')) D.notify(a.id, 'Data-protection request', `${ctx.user.name} (${ctx.user.role.replace('_', ' ')}) asked for: ${b.kind.replace('_', ' ')}. Reply within ${DUE_DAYS} days.`, 'admin', '#/admin/privacy');
  if (ctx.user.role === 'tenant' && ctx.user.ownerId) D.notify(ctx.user.ownerId, 'Tenant data request', `${ctx.user.name} made a data-protection request (${b.kind.replace('_', ' ')}). As the data controller for tenancy records you must respond; National Administration will help.`, 'admin', '#/tenants');
  D.audit(ctx, 'privacy.request', 'dsr', r.id, { kind: b.kind });
  return { request: { id: r.id, kind: r.kind, status: r.status, dueBy: r.dueBy }, message: 'Request received. We will reply within the time the law allows (no later than 30 days).' };
});
// People without accounts (visitors, leads, guests, providers) can use the same rights.
H.route('POST', '/api/public/data-request', { public: true, rate: [5, 3600000] }, async (ctx) => {
  const b = clean(ctx.body, { name: { t: 's', req: true, min: 2, max: 80 }, phone: { t: 'phone' }, email: { t: 'email' }, kind: { t: 'e', values: KINDS, req: true }, note: { t: 's', max: 500 }, website: { t: 's', max: 50 } });
  if (b.website) return { ok: true };
  if (!b.phone && !b.email) throw E.bad('Give the phone number or email address you used with us, so we can find your data.');
  const r = db.dsr.insert({ userId: null, subjectName: b.name, subjectContact: b.phone || b.email, phone: b.phone || null, email: b.email || null, role: 'public', kind: b.kind, note: b.note || '', status: 'new', dueBy: Date.now() + DUE_DAYS * 864e5 });
  for (const a of db.users.where('role', 'national_admin')) D.notify(a.id, 'Data-protection request (public)', `${b.name} asked for: ${b.kind.replace('_', ' ')}.`, 'admin', '#/admin/privacy');
  return { ok: true, message: 'Request received. We will contact you to confirm your identity and reply within the time the law allows (no later than 30 days).', ref: r.id.slice(-6) };
});

/* ---------- National Administration ---------- */
H.route('GET', '/api/admin/data-requests', { perm: 'platform.privacy' }, async (ctx) => {
  const st = ctx.query.status; let rows = db.dsr.all(); if (st) rows = rows.filter((r) => r.status === st);
  const now = Date.now();
  return { requests: rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 300).map((r) => ({ id: r.id, kind: r.kind, status: r.status, name: r.subjectName, contact: r.subjectContact, role: r.role, note: r.note, response: r.response || '', createdAt: r.createdAt, dueBy: r.dueBy, overdue: ['new', 'in_progress'].includes(r.status) && r.dueBy < now })), kinds: KINDS };
});
/** Removes or anonymises what we hold about a person who has no account (alerts, viewing requests, leads, service requests). */
function erasePublic(phone, email) {
  let n = 0;
  if (phone) {
    for (const a of db.alerts.where('phone', phone)) { db.alerts.remove(a.id); n++; }
    for (const v of db.viewings.where('phone', phone)) { db.viewings.update(v.id, { name: 'Erased', phone: '', message: '' }); n++; }
    for (const l of db.leads.where('phone', phone)) { db.leads.update(l.id, { name: 'Erased', phone: '', email: '', notes: [], preferences: '' }); n++; }
    for (const r of db.service_requests.all().filter((x) => x.phone === phone)) { db.service_requests.update(r.id, { name: 'Erased', phone: '', message: '' }); n++; }
  }
  if (email) for (const l of db.leads.where('email', email)) { db.leads.update(l.id, { name: 'Erased', phone: '', email: '', notes: [], preferences: '' }); n++; }
  return n;
}
H.route('POST', '/api/admin/data-requests/:id/resolve', { perm: 'platform.privacy', rate: [60, 60000] }, async (ctx) => {
  const b = clean(ctx.body, { status: { t: 'e', values: ['in_progress', 'completed', 'rejected'], req: true }, response: { t: 's', max: 500, req: true, label: 'Reply to the person' }, eraseVisitorData: { t: 'b' } });
  const r = db.dsr.get(ctx.params.id); if (!r) throw E.notFound();
  let erased = 0;
  if (b.eraseVisitorData && r.kind === 'erasure' && b.status === 'completed') erased = erasePublic(r.phone || (db.users.get(r.userId) || {}).phone, r.email);
  const up = db.dsr.update(r.id, { status: b.status, response: b.response, resolvedAt: b.status === 'in_progress' ? null : Date.now(), resolvedBy: ctx.user.id, erasedRecords: erased });
  if (r.userId) D.notify(r.userId, 'Your data request was updated', `${r.kind.replace('_', ' ')}: ${b.status.replace('_', ' ')}. ${b.response}`, 'privacy', '#/privacy-centre');
  S.audit.append({ actor: ctx.user.id, role: ctx.user.role, action: 'privacy.request_' + b.status, entity: 'dsr', entityId: r.id, ip: ctx.ip, detail: { kind: r.kind, erased } });
  return { request: { id: up.id, status: up.status }, erased };
});
H.route('GET', '/api/admin/legal', { perm: 'platform.privacy' }, async () => ({ legal: P.config().legal, version: L.VERSION }));
H.route('PUT', '/api/admin/legal', { perm: 'platform.privacy', rate: [20, 3600000] }, async (ctx) => {
  const b = clean(ctx.body, { controllerName: { t: 's', req: true, max: 100 }, address: { t: 's', max: 160 }, town: { t: 's', max: 80 }, email: { t: 'email' }, phone: { t: 's', max: 30 }, dpoName: { t: 's', max: 80 }, dpoEmail: { t: 'email' }, odpcRegNo: { t: 's', max: 40 }, kraPin: { t: 's', max: 20 } });
  const c = P.config(); P.saveConfig({ ...S.meta.get('platform:config', {}), legal: { ...c.legal, ...b } }, ctx, 'legal');
  S.audit.append({ actor: ctx.user.id, role: ctx.user.role, action: 'privacy.legal_details_changed', entity: 'platform', ip: ctx.ip });
  return { legal: P.config().legal };
});

module.exports = { recordConsent, exportFor, erasePublic };
