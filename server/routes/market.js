'use strict';
// Marketplace features: public listing media, viewing bookings, search alerts, tenant rental passport, API reference.
const S = require('../store');
const { db } = S;
const U = require('../util');
const { E, clean, log } = U;
const sec = require('../sec');
const gw = require('../gateways');
const H = require('../http');
const D = require('../domain');
const P = require('../platform');
const OPS = require('./ops');
const RP = require('./reports');

/* ============ public media (photos / videos of listed houses) ============ */
H.route('GET', '/api/public/media/:id', { public: true, rate: [600, 60000] }, async (ctx) => {
  const f = db.files.get(ctx.params.id);
  if (!f || !['listing', 'sale'].includes(f.refType) || !P.config().listingsPublic) throw E.notFound();
  if (f.refType === 'sale') { if (f.mime === 'application/pdf' || !require('./ecosystem').isPublicSale(db.sales.get(f.refId))) throw E.notFound(); } // only verified, active sale listings; documents stay private
  else if (!RP.listingsFor({}).some((l) => l.id === f.refId)) throw E.notFound(); // only verified, listed, vacant houses
  return OPS.sendFile(ctx, f, { 'Cache-Control': 'public, max-age=300', 'Content-Disposition': 'inline' });
});

/* ============ viewing bookings ("tours") ============ */
const SLOTS = ['morning', 'afternoon', 'evening'];
const vView = (v) => ({ id: v.id, unitId: v.unitId, unitName: (db.units.get(v.unitId) || {}).name || '', propertyName: (db.properties.get(v.propertyId) || {}).name || '', name: v.name, phone: v.phone, date: v.date, slot: v.slot, time: v.time || '', message: v.message || '', status: v.status, note: v.note || '', createdAt: v.createdAt, repeatNoShows: v.repeatNoShows || 0 });
H.route('POST', '/api/public/viewings', { public: true, rate: [6, 600000] }, async (ctx) => {
  if (!P.config().listingsPublic) throw E.notFound();
  const b = clean(ctx.body, { unitId: { t: 'id', req: true }, name: { t: 's', req: true, min: 2, max: 80 }, phone: { t: 'phone', req: true }, date: { t: 'd', req: true, label: 'Viewing date' }, slot: { t: 'e', values: SLOTS, req: true }, message: { t: 's', max: 300 }, consent: { t: 'b' }, website: { t: 's', max: 50 } });
  if (b.website) return { ok: true };
  if (!b.consent) throw E.bad('Please tick the box to allow the landlord or agent to contact you about this viewing.');
  const l = RP.listingsFor({}).find((x) => x.id === b.unitId); if (!l) throw E.notFound('This house is no longer available');
  const today = U.todayStr(); if (b.date < today || U.daysBetween(today, b.date) > 30) throw E.bad('Pick a day within the next 30 days.');
  if (db.viewings.where('phone', b.phone).filter((v) => v.status === 'requested' && v.createdAt > Date.now() - 864e5).length >= 3) throw E.conflict('You already have several viewing requests waiting. Please wait for replies.');
  const unit = db.units.get(b.unitId); const token = sec.randomToken(18);
  const noShows = db.viewings.where('phone', b.phone).filter((v) => v.status === 'no_show').length;
  db.consents.insert({ subject: b.phone, purpose: 'viewing_request', legalVersion: require('../legal').VERSION, ip: ctx.ip });
  const v = db.viewings.insert({ ownerId: unit.ownerId, propertyId: unit.propertyId, unitId: unit.id, name: b.name, phone: b.phone, date: b.date, slot: b.slot, message: b.message || '', status: 'requested', tokenHash: sec.sha256(token), repeatNoShows: noShows, ip: ctx.ip });
  D.notifyOrg(unit.ownerId, unit.propertyId, 'Viewing requested', `${b.name} wants to see ${l.type} at ${l.property} on ${b.date} (${b.slot}).`, 'viewing', '#/viewings');
  D.smsTo(unit.ownerId, b.phone, `We got your viewing request for ${l.type}, ${l.property}, ${b.date} ${b.slot}. The landlord will confirm shortly.`);
  return { ok: true, token, message: 'Request sent! The landlord or agent will confirm the time. Save your tracking link to see the reply.' };
});
H.route('GET', '/api/public/viewings/:token', { public: true, rate: [60, 60000] }, async (ctx) => {
  const v = db.viewings.find('tokenHash', sec.sha256(String(ctx.params.token).slice(0, 80))); if (!v) throw E.notFound();
  const u = db.units.get(v.unitId) || {}; const p = db.properties.get(v.propertyId) || {};
  return { viewing: { status: v.status, date: v.date, slot: v.slot, time: v.time || '', note: v.note || '', house: `${u.type || ''} - ${p.name || ''}, ${p.town || ''}`, address: v.status === 'confirmed' ? [p.address, p.town].filter(Boolean).join(', ') : null } };
});
H.route('GET', '/api/viewings', { perm: 'inquiry.read' }, async (ctx) => ({ viewings: D.listScoped(db.viewings, ctx).sort((a, b) => (a.date > b.date ? 1 : -1)).slice(-300).map(vView) }));
H.route('POST', '/api/viewings/:id/respond', { perm: 'unit.write', rate: [60, 60000] }, async (ctx) => {
  const v = D.getScoped(db.viewings, ctx.params.id, ctx);
  const b = clean(ctx.body, { status: { t: 'e', values: ['confirmed', 'declined', 'done', 'no_show'], req: true }, time: { t: 's', max: 10, re: /^([01]?\d|2[0-3]):[0-5]\d$/ }, note: { t: 's', max: 200 } });
  const ok = { requested: ['confirmed', 'declined'], confirmed: ['declined', 'done', 'no_show', 'confirmed'], declined: [], done: [], no_show: [] }[v.status];
  if (!ok.includes(b.status)) throw E.conflict('That viewing is already ' + v.status.replace('_', ' ') + '.');
  if (b.status === 'confirmed' && !b.time) throw E.bad('Choose the time you will meet them.');
  const up = db.viewings.update(v.id, { status: b.status, time: b.time || v.time, note: b.note || '', respondedBy: ctx.user.id });
  const u = db.units.get(v.unitId) || {};
  const msg = b.status === 'confirmed' ? `Viewing confirmed: ${v.date} at ${up.time}. ${b.note || ''}` : b.status === 'declined' ? `Sorry, that viewing time is not possible. ${b.note || 'Please request another day.'}` : null;
  if (msg) D.smsTo(v.ownerId, v.phone, `Jasmyle Properties (${u.name || 'house'}): ${msg}`.slice(0, 300));
  D.audit(ctx, 'viewing.' + b.status, 'viewing', v.id, {});
  return { viewing: vView(up) };
});

/* ============ search alerts ("tell me when a matching house is listed") ============ */
const ALQ = { county: { t: 's', max: 40 }, q: { t: 's', max: 60 }, maxRent: { t: 'n', max: 1e8 }, bedrooms: { t: 'n', int: true, max: 20 }, type: { t: 's', max: 30 } };
H.route('POST', '/api/public/alerts', { public: true, rate: [6, 3600000] }, async (ctx) => {
  const b = clean(ctx.body, { phone: { t: 'phone', req: true }, website: { t: 's', max: 50 }, consent: { t: 'b' }, ...ALQ });
  if (b.website) return { ok: true };
  if (!b.consent) throw E.bad('Please tick the box to agree to receive SMS alerts. You can stop them at any time.');
  const { phone, website, consent, ...crit } = b;
  db.consents.insert({ subject: phone, purpose: 'sms_alerts', legalVersion: require('../legal').VERSION, ip: ctx.ip });
  if (db.alerts.where('phone', phone).filter((a) => a.active).length >= 5) throw E.conflict('You already have 5 alerts on this number. Stop one first.');
  const token = sec.randomToken(18);
  const seen = RP.listingsFor(clean(crit, RP.LQ)).map((l) => l.id);
  db.alerts.insert({ phone, criteria: crit, active: true, tokenHash: sec.sha256(token), seen, sentToday: 0, day: U.todayStr() });
  return { ok: true, stopLink: `/#/alert-stop/${token}`, message: 'Saved. We will text you when a matching house is listed.' };
});
H.route('GET', '/api/public/alerts/stop/:token', { public: true, rate: [20, 60000] }, async (ctx) => {
  const a = db.alerts.find('tokenHash', sec.sha256(String(ctx.params.token).slice(0, 80))); if (!a) throw E.notFound();
  db.alerts.update(a.id, { active: false }); return { ok: true };
});
async function runAlerts() {
  const ps = P.config().payout.sms; const url = D.publicUrl(); let sent = 0;
  const smsOn = ps && ps.enabled && ps.apiKeyEnc;
  for (const a of db.alerts.where('active', true)) {
    const today = U.todayStr(); const day = a.day === today ? a.sentToday : 0;
    const fresh = RP.listingsFor(clean(a.criteria, RP.LQ)).filter((l) => !a.seen.includes(l.id));
    if (!fresh.length) continue;
    if (!smsOn || day >= 3) continue; // nothing is marked as seen until it is actually sent
    const l = fresh[0];
    const ok = await gw.sendSms(ps, a.phone, `Jasmyle Properties: new ${l.type} in ${l.town}, KES ${l.rent.toLocaleString()}/mo. ${url ? url + '/#/listing/' + l.id : ''} Stop: ${url}/#/alert-stop-info`.slice(0, 300));
    if (ok) { db.alerts.update(a.id, { seen: [...a.seen, l.id].slice(-300), sentToday: day + 1, day: today }); sent++; }
  }
  return sent;
}

/* ============ tenant rental passport (verified payment record the tenant chooses to share) ============ */
function passportData(t) {
  const today = U.todayStr(); const leases = db.leases.where('tenantId', t.id);
  const invs = db.invoices.where('tenantId', t.id).filter((i) => i.type === 'rent' && i.status !== 'void' && i.dueDate <= today);
  const pays = db.payments.where('tenantId', t.id).filter((p) => p.status === 'completed');
  let onTime = 0, late = 0, unpaid = 0;
  for (const i of invs) {
    if (i.paid + 0.004 < i.amount) { unpaid++; continue; }
    const last = Math.max(0, ...pays.filter((p) => (p.allocations || []).some((a) => a.invoiceId === i.id)).map((p) => p.paidAt || 0));
    if (last && U.dateOf(last) <= U.addDays(i.dueDate, 3)) onTime++; else late++;
  }
  const settled = onTime + late; const rate = settled ? Math.round((onTime / settled) * 100) : null;
  const first = leases.map((l) => l.startDate).sort()[0] || null;
  const grade = rate === null ? 'New tenant' : unpaid > 1 ? 'Needs attention' : rate >= 90 ? 'Excellent' : rate >= 70 ? 'Good' : 'Fair';
  const parts = String(t.name).trim().split(/\s+/);
  return { name: parts[0] + (parts[1] ? ' ' + parts[1][0] + '.' : ''), since: first, monthsRented: first ? Math.max(0, Math.round(U.daysBetween(first, today) / 30)) : 0, rentMonthsRecorded: invs.length, paidOnTime: onTime, paidLate: late, unpaidNow: unpaid, onTimeRate: rate, grade, currentlyRenting: leases.some((l) => l.status === 'active'), generated: Date.now() };
}
H.route('GET', '/api/me/passport', { roles: ['tenant'] }, async (ctx) => ({ links: (ctx.user.passportLinks || []).filter((l) => l.exp > Date.now()).map((l) => ({ id: l.id, exp: l.exp, createdAt: l.createdAt })), preview: passportData(ctx.user) }));
H.route('POST', '/api/me/passport', { roles: ['tenant'], rate: [10, 3600000] }, async (ctx) => {
  const b = clean(ctx.body, { days: { t: 'n', int: true, min: 1, max: 90, def: 14 } });
  const token = sec.randomToken(20); const link = { id: U.newId('ppt'), tokenHash: sec.sha256(token), exp: Date.now() + b.days * 864e5, createdAt: Date.now() };
  const cur = (ctx.user.passportLinks || []).filter((l) => l.exp > Date.now()).slice(-4);
  db.users.update(ctx.user.id, { passportLinks: [...cur, link] });
  D.audit(ctx, 'account.passport_created', 'user', ctx.user.id, { days: b.days });
  return { token, url: `/#/passport/${token}`, exp: link.exp };
});
H.route('DELETE', '/api/me/passport/:id', { roles: ['tenant'] }, async (ctx) => { db.users.update(ctx.user.id, { passportLinks: (ctx.user.passportLinks || []).filter((l) => l.id !== ctx.params.id) }); D.audit(ctx, 'account.passport_revoked', 'user', ctx.user.id, {}); return { ok: true }; });
H.route('GET', '/api/public/passport/:token', { public: true, rate: [30, 60000] }, async (ctx) => {
  const h = sec.sha256(String(ctx.params.token).slice(0, 80));
  const t = db.users.where('role', 'tenant').find((u) => (u.passportLinks || []).some((l) => l.tokenHash === h && l.exp > Date.now()));
  if (!t) throw E.notFound('This link has expired or was cancelled.');
  const link = t.passportLinks.find((l) => l.tokenHash === h);
  return { passport: passportData(t), validUntil: link.exp };
});

/* ============ API reference (OpenAPI 3) generated from the live route table ============ */
function openapi() {
  const R = require('../roles');
  const paths = {};
  for (const r of H.routes) {
    const p = r.pattern.replace(/:([A-Za-z]+)/g, '{$1}'); const tag = (p.split('/')[2] || 'misc');
    const perm = r.opts.perm || (r.opts.anyPerm && r.opts.anyPerm.join(' | ')) || null;
    const op = { tags: [tag], summary: perm && R.PERMS[r.opts.perm] ? R.PERMS[r.opts.perm] : `${r.method} ${p}`, 'x-permission': perm, 'x-roles': r.opts.roles || undefined, 'x-rate-limit': r.opts.rate ? `${r.opts.rate[0]} per ${r.opts.rate[1] / 1000}s` : undefined,
      security: r.opts.public ? [] : [{ session: [], csrf: [] }], parameters: r.keys.map((k) => ({ name: k, in: 'path', required: true, schema: { type: 'string' } })),
      responses: { 200: { description: 'OK' }, 400: { description: 'Invalid input (message explains)' }, 401: { description: 'Not signed in' }, 403: { description: 'Role is not allowed' }, 404: { description: 'Not found - also returned for records outside your landlord organisation' }, 429: { description: 'Too many requests' } } };
    if (!['GET', 'DELETE'].includes(r.method)) op.requestBody = { content: { 'application/json': { schema: { type: 'object' } } } };
    (paths[p] = paths[p] || {})[r.method.toLowerCase()] = op;
  }
  return { openapi: '3.0.3', info: { title: 'Jasmyle Properties API', version: require('../../package.json').version, description: 'Every endpoint with its permission, role limit and rate limit. Sign in with POST /api/auth/login (cookie session); send the csrf value returned at login in the X-CSRF-Token header on every non-GET call. Records are always filtered to your own landlord organisation.' },
    servers: [{ url: '/' }], tags: [...new Set(Object.keys(paths).map((p) => p.split('/')[2]))].map((name) => ({ name })), paths,
    components: { securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'nh_sid' }, csrf: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' } } } };
}
H.route('GET', '/api/docs/openapi.json', { skipGate: true }, async () => openapi());

module.exports = { runAlerts, passportData, openapi };
