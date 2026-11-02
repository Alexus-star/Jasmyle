'use strict';
// Sign-in, sessions, passwords, two-factor authentication, landlord self-registration.
const S = require('../store');
const { db } = S;
const U = require('../util');
const { E, clean } = U;
const sec = require('../sec');
const cfg = require('../config');
const R = require('../roles');
const H = require('../http');
const D = require('../domain');

const COOKIE = 'nh_sid';

/* ---------- sessions ---------- */
function ttl(role) { return cfg.session[role] || [8 * 3600e3, 86400e3]; }
function createSession(ctx, user) {
  const token = sec.randomToken(32);
  const [idle, abs] = ttl(user.role);
  const now = Date.now();
  const rec = db.sessions.insert({ userId: user.id, tokenHash: sec.sha256(token), csrf: sec.randomToken(24), expiresAt: now + abs, idleMs: idle, lastSeen: now, ip: ctx.ip, ua: String(ctx.req.headers['user-agent'] || '').slice(0, 160) });
  const maxAge = Math.floor(abs / 1000);
  ctx.setCookie = `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${ctx.secure ? '; Secure' : ''}`;
  return rec;
}
const clearCookie = (ctx) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${ctx.secure ? '; Secure' : ''}`;
function killSessions(userId, exceptId) {
  for (const s of db.sessions.where('userId', userId)) if (s.id !== exceptId) db.sessions.remove(s.id);
}

H.setSessionLoader(async (ctx) => {
  const token = ctx.cookies[COOKIE];
  if (!token || token.length > 80) return;
  const s = db.sessions.find('tokenHash', sec.sha256(token));
  if (!s) return;
  const now = Date.now();
  if (s.expiresAt < now || now - s.lastSeen > s.idleMs) { db.sessions.remove(s.id); return; }
  const user = db.users.get(s.userId);
  if (!user || user.status !== 'active') { db.sessions.remove(s.id); return; }
  if (user.role === 'national_admin' && !H.ipAllowed(ctx.ip, cfg.adminIpAllowlist)) return;
  if (now - s.lastSeen > 60000) db.sessions.update(s.id, { lastSeen: now });
  ctx.user = user; ctx.session = s;
  // Sliding cookie not needed: the server enforces idle + absolute limits itself.
});
// attach Set-Cookie on every response where we asked for one
const origJson = null; // (cookie is applied through ctx.json override below)

function meView(user, session, extra = {}) {
  const owner = user.ownerId && user.ownerId !== user.id ? db.users.get(user.ownerId) : user;
  const st = user.ownerId ? D.getSettings(user.ownerId) : null;
  const role = R.ROLES[user.role];
  return {
    id: user.id, name: user.name, role: user.role, roleLabel: role.label, email: user.email || null, phone: user.phone || null,
    ownerId: user.ownerId || null, orgName: (st && st.orgName) || (owner && (owner.company || owner.name)) || '',
    mustChangePassword: !!user.mustChangePassword, mfaEnabled: !!(user.totp && user.totp.enabled), mfaRequired: user.role === 'national_admin',
    isSuper: !!user.isSuper, assignedPropertyIds: user.assignedPropertyIds || [], approvalLimit: user.approvalLimit ?? null,
    perms: role.perms, mode: st ? st.mode : null, csrf: session ? session.csrf : null,
    legalVersion: require('../legal').VERSION, legalAccepted: user.legalVersion === require('../legal').VERSION, ...extra,
  };
}

function withCookie(ctx, fn) {
  const origJson = ctx.json;
  ctx.json = (data, status, extra) => origJson(data, status, { ...(extra || {}), ...(ctx.setCookie ? { 'Set-Cookie': ctx.setCookie } : {}) });
  return fn();
}

/* ---------- login ---------- */
const FAIL = 'Incorrect email/phone or password';
H.route('POST', '/api/auth/login', { public: true, rate: [12, 60000] }, async (ctx) => withCookie(ctx, async () => {
  const b = clean(ctx.body, { identifier: { t: 's', req: true, max: 120, label: 'Email or phone' }, password: { t: 's', req: true, max: 200, raw: true, label: 'Password' }, code: { t: 's', max: 20 } });
  const id = b.identifier.toLowerCase();
  H.limit('loginid:' + id, 10, 15 * 60000, 'Too many attempts for this account. Please wait 15 minutes.');
  const user = id.includes('@') ? db.users.find('email', id) : db.users.find('phone', U.normPhone(id) || 'x');
  if (!user) { await sec.dummyVerify(b.password); S.audit.append({ action: 'auth.login_failed', ip: ctx.ip, detail: { reason: 'unknown_account' } }); throw E.unauth(FAIL); }
  if (user.lockedUntil && user.lockedUntil > Date.now()) {
    throw E.tooMany(`This account is temporarily locked after too many wrong passwords. Try again in ${Math.ceil((user.lockedUntil - Date.now()) / 60000)} minute(s).`);
  }
  const fail = (reason) => {
    const n = (user.failed || 0) + 1;
    const patch = { failed: n };
    if (n >= 5) { patch.lockedUntil = Date.now() + Math.min(24 * 3600e3, 15 * 60000 * 2 ** Math.floor((n - 5) / 5)); }
    db.users.update(user.id, patch);
    S.audit.append({ owner: user.ownerId, actor: user.id, role: user.role, action: 'auth.login_failed', ip: ctx.ip, detail: { reason } });
  };
  if (!(await sec.verifyPassword(b.password, user.passHash))) { fail('bad_password'); throw E.unauth(FAIL); }
  if (user.status === 'pending') throw E.forbidden('Your account is waiting for approval by National Administration. You will be able to sign in once it is approved.');
  if (user.status !== 'active') throw E.forbidden('This account has been suspended. Please contact your landlord or National Administration.');
  if (user.role === 'national_admin' && !H.ipAllowed(ctx.ip, cfg.adminIpAllowlist)) {
    S.audit.append({ actor: user.id, role: user.role, action: 'auth.admin_ip_blocked', ip: ctx.ip });
    throw E.forbidden('Administrator sign-in is not allowed from this location.');
  }
  let patch = { failed: 0, lockedUntil: 0, lastLoginAt: Date.now(), lastIp: ctx.ip };
  if (user.totp && user.totp.enabled) {
    if (!b.code) return { needs2fa: true };
    const code = b.code.replace(/\s/g, '');
    if (/^\d{6}$/.test(code)) {
      const step = sec.totpCheck(sec.decField(user.totp.secretEnc), code, user.totp.lastStep || 0);
      if (!step) { fail('bad_2fa'); throw E.unauth('That verification code is not correct or has expired'); }
      patch.totp = { ...user.totp, lastStep: step };
    } else {
      const h = sec.sha256(code.toLowerCase());
      if (!(user.recovery || []).includes(h)) { fail('bad_recovery'); throw E.unauth('That verification code is not correct'); }
      patch.recovery = user.recovery.filter((x) => x !== h);
    }
  }
  const fresh = db.users.update(user.id, patch);
  const sess = createSession(ctx, fresh);
  S.audit.append({ owner: fresh.ownerId, actor: fresh.id, role: fresh.role, action: 'auth.login', ip: ctx.ip });
  return meView(fresh, sess);
}));

H.route('POST', '/api/auth/logout', { noCsrf: false, skipGate: true }, async (ctx) => {
  db.sessions.remove(ctx.session.id);
  S.audit.append({ owner: ctx.user.ownerId, actor: ctx.user.id, role: ctx.user.role, action: 'auth.logout', ip: ctx.ip });
  ctx.json({ ok: true }, 200, { 'Set-Cookie': clearCookie(ctx) });
});

// "who am I" - does not require CSRF (GET) and returns the CSRF token for the SPA
H.route('GET', '/api/me', { public: true, skipGate: true }, async (ctx) => {
  if (!ctx.user) return ctx.json({ user: null }, 200);
  return { user: meView(ctx.user, ctx.session) };
});

/* ---------- password ---------- */
H.route('POST', '/api/auth/change-password', { skipGate: true, rate: [8, 60000] }, async (ctx) => {
  const b = clean(ctx.body, { current: { t: 's', req: true, max: 200, raw: true }, next: { t: 's', req: true, max: 200, raw: true } });
  if (!(await sec.verifyPassword(b.current, ctx.user.passHash))) throw E.bad('Your current password is not correct');
  if (b.current === b.next) throw E.bad('Choose a password different from the current one');
  const why = sec.checkPassword(b.next, { email: ctx.user.email, name: ctx.user.name });
  if (why) throw E.bad(why);
  db.users.update(ctx.user.id, { passHash: await sec.hashPassword(b.next), mustChangePassword: false, passChangedAt: Date.now() });
  killSessions(ctx.user.id, ctx.session.id);
  D.audit(ctx, 'auth.password_changed', 'user', ctx.user.id);
  return { ok: true };
});

/* ---------- two-factor ---------- */
H.route('POST', '/api/auth/2fa/setup', { skipGate: true, rate: [10, 60000] }, async (ctx) => {
  const b = clean(ctx.body, { password: { t: 's', req: true, max: 200, raw: true } });
  if (!(await sec.verifyPassword(b.password, ctx.user.passHash))) throw E.bad('Your password is not correct');
  if (ctx.user.mustChangePassword) throw E.bad('Please set a new password first');
  const secret = sec.totpSecret();
  db.users.update(ctx.user.id, { totpPendingEnc: sec.encField(secret) });
  return { secret, uri: sec.totpUri(secret, ctx.user.email || ctx.user.phone || ctx.user.name), issuer: cfg.appName };
});
H.route('POST', '/api/auth/2fa/enable', { skipGate: true, rate: [10, 60000] }, async (ctx) => {
  const b = clean(ctx.body, { code: { t: 's', req: true, max: 10 } });
  if (!ctx.user.totpPendingEnc) throw E.bad('Start the setup again');
  const secret = sec.decField(ctx.user.totpPendingEnc);
  const step = sec.totpCheck(secret, b.code.replace(/\s/g, ''), 0);
  if (!step) throw E.bad('That code is not correct. Check that your phone clock is automatic and try the newest code.');
  const codes = Array.from({ length: 8 }, () => sec.randomToken(6).toLowerCase().replace(/[-_]/g, 'x').slice(0, 10));
  db.users.update(ctx.user.id, { totp: { enabled: true, secretEnc: ctx.user.totpPendingEnc, lastStep: step }, totpPendingEnc: null, recovery: codes.map((c) => sec.sha256(c)) });
  D.audit(ctx, 'auth.2fa_enabled', 'user', ctx.user.id);
  return { ok: true, recoveryCodes: codes };
});
H.route('POST', '/api/auth/2fa/disable', { rate: [5, 60000] }, async (ctx) => {
  if (ctx.user.role === 'national_admin') throw E.forbidden('National Administrators must keep two-factor authentication on.');
  const b = clean(ctx.body, { password: { t: 's', req: true, max: 200, raw: true } });
  if (!(await sec.verifyPassword(b.password, ctx.user.passHash))) throw E.bad('Your password is not correct');
  db.users.update(ctx.user.id, { totp: null, recovery: [] });
  D.audit(ctx, 'auth.2fa_disabled', 'user', ctx.user.id);
  return { ok: true };
});

/* ---------- active sessions ---------- */
H.route('GET', '/api/auth/sessions', { skipGate: true }, async (ctx) => ({
  sessions: db.sessions.where('userId', ctx.user.id).map((s) => ({ id: s.id, ip: s.ip, ua: s.ua, createdAt: s.createdAt, lastSeen: s.lastSeen, current: s.id === ctx.session.id })),
}));
H.route('POST', '/api/auth/sessions/revoke-others', { skipGate: true }, async (ctx) => { killSessions(ctx.user.id, ctx.session.id); return { ok: true }; });

/* ---------- landlord self-registration (needs approval by National Administration) ---------- */
H.route('POST', '/api/auth/register-landlord', { public: true, rate: [4, 3600000] }, async (ctx) => {
  const b = clean(ctx.body, {
    name: { t: 's', req: true, max: 80, min: 2, label: 'Your name' }, company: { t: 's', max: 100 }, email: { t: 'email', req: true, label: 'Email' },
    phone: { t: 'phone', req: true, label: 'Phone' }, county: { t: 's', max: 40 }, town: { t: 's', max: 60 }, password: { t: 's', req: true, max: 200, raw: true, label: 'Password' },
    acceptTerms: { t: 'b' },
  });
  if (!b.acceptTerms) throw E.bad('Please read and accept the Terms and Conditions and the Privacy Notice to create an account.', 'terms_required');
  const why = sec.checkPassword(b.password, b);
  if (why) throw E.bad(why);
  const regMode = require('../platform').config().registration;
  if (regMode === 'closed') throw E.forbidden('New landlord registration is closed at the moment. Please contact support.');
  const { password, acceptTerms, ...f } = b;
  const { user } = await D.makeUser({ ...f, role: 'landlord', legalVersion: require('../legal').VERSION, legalAcceptedAt: Date.now(), status: regMode === 'open' ? 'active' : 'pending', approvedAt: regMode === 'open' ? Date.now() : undefined, selfRegistered: true }, { password, mustChange: false });
  db.consents.insert({ userId: user.id, subject: user.email, purpose: 'terms_and_privacy', legalVersion: require('../legal').VERSION, ip: ctx.ip, ua: String(ctx.req.headers['user-agent'] || '').slice(0, 160) });
  if (regMode === 'open') D.ensureSettings(user.id);
  S.audit.append({ owner: user.id, actor: user.id, role: 'landlord', action: 'account.landlord_registered', entity: 'user', entityId: user.id, ip: ctx.ip });
  for (const a of db.users.where('role', 'national_admin')) D.notify(a.id, 'New landlord waiting for approval', `${user.name} (${user.company || user.email}) registered.`, 'admin', '#/admin/landlords');
  return { ok: true, message: regMode === 'open' ? 'Your account is ready. You can sign in now.' : 'Thank you! Your account is waiting for approval by National Administration. You can sign in as soon as it is approved.' };
});

/* ---------- first-run setup (create the first National Administrator from the browser) ---------- */
// Works ONLY while no National Administrator exists, and ONLY when the browser is on the server computer itself
// (a direct local connection with no proxy headers), so nobody on the internet or Wi-Fi can claim the system.
const hasAdmin = () => db.users.where('role', 'national_admin').length > 0;
const fromThisComputer = (req) => {
  const a = req.socket.remoteAddress || '';
  const local = a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
  const proxied = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip', 'forwarded', 'x-forwarded-host'].some((h) => req.headers[h]);
  return local && !proxied;
};
let settingUp = false;
H.route('GET', '/api/public/setup-status', { public: true }, async (ctx) => ({ needsSetup: !hasAdmin(), canSetupHere: fromThisComputer(ctx.req), setupTokenRequired: !fromThisComputer(ctx.req) && !!cfg.setupToken }));
// Lets apps (the Android app, a browser) check that an address really is a Jasmyle Properties server before using it.
H.route('GET', '/api/public/info', { public: true }, async () => ({ app: 'Jasmyle Properties', name: cfg.appName, apiVersion: 1, version: require('../../package.json').version, needsSetup: !hasAdmin() }));
const tokenOk = (given) => { const a = require('crypto').createHash('sha256').update(String(given || '')).digest(); const b = require('crypto').createHash('sha256').update(cfg.setupToken).digest(); return !!cfg.setupToken && require('crypto').timingSafeEqual(a, b); };
H.route('POST', '/api/public/first-admin', { public: true, rate: [10, 600000] }, async (ctx) => {
  if (hasAdmin() || settingUp) throw E.forbidden('This system is already set up. Please sign in.');
  if (!fromThisComputer(ctx.req) && !tokenOk(ctx.body && ctx.body.setupToken)) throw E.forbidden(cfg.setupToken ? 'Wrong or missing setup code.' : 'First-time setup can only be done on the computer that runs Jasmyle Properties (open http://localhost:' + cfg.port + ' there), or on a cloud server by setting the NH_SETUP_TOKEN secret.');
  const b = clean(ctx.body, { name: { t: 's', req: true, max: 80, min: 2, label: 'Your name' }, email: { t: 'email', req: true, label: 'Email' }, phone: { t: 'phone', label: 'Phone' }, password: { t: 's', req: true, max: 200, raw: true, label: 'Password' } });
  const why = sec.checkPassword(b.password, b);
  if (why) throw E.bad(why);
  settingUp = true;
  try {
    const { password, ...f } = b; if (!f.phone) delete f.phone;
    const { user } = await D.makeUser({ ...f, role: 'national_admin', ownerId: null, isSuper: true, status: 'active' }, { password, mustChange: false });
    S.audit.append({ actor: user.id, role: 'national_admin', action: 'admin.super_created', entity: 'user', entityId: user.id, detail: { via: 'browser-setup' }, ip: ctx.ip });
    return { ok: true, email: user.email };
  } finally { settingUp = false; }
});

/* ---------- change my phone number ---------- */
// Policy (set by National Administration): otp = code sent by SMS to the NEW number; approval = landlord/manager approves;
// staff_only = tenants cannot do it themselves. Always needs the current password.
function smsFor(user) {
  const P = require('../platform'); const gw = require('../gateways');
  const own = user.ownerId ? D.getSettings(user.ownerId) : null;
  if (own && own.sms && own.sms.enabled && own.sms.apiKeyEnc) return own.sms;
  const ps = P.config().payout.sms; return ps && ps.enabled && ps.apiKeyEnc ? ps : null;
}
H.route('GET', '/api/me/phone', { skipGate: true }, async (ctx) => {
  const P = require('../platform'); const pol = P.config().phoneChange; const u = ctx.user;
  return { phone: u.phone || null, policy: pol, mode: u.role === 'tenant' ? (pol === 'staff_only' ? 'staff_only' : pol === 'otp' && smsFor(u) ? 'otp' : 'approval') : (smsFor(u) ? 'otp' : 'direct'), pending: u.phoneRequest && u.phoneRequest.status === 'pending' ? u.phoneRequest.phone : null, otpPending: !!(u.phoneChange && u.phoneChange.exp > Date.now()) };
});
H.route('POST', '/api/me/phone/request', { rate: [5, 3600000] }, async (ctx) => {
  const P = require('../platform'); const gw = require('../gateways'); const core = require('./core');
  const b = clean(ctx.body, { phone: { t: 'phone', req: true, label: 'New phone number' }, password: { t: 's', req: true, max: 200, raw: true } });
  const u = ctx.user;
  if (!(await sec.verifyPassword(b.password, u.passHash))) throw E.bad('Your password is not correct.');
  if (!U.isKenyanMobile(b.phone)) throw E.bad('Enter a valid Kenyan mobile number, for example 0712 345 678.');
  if (b.phone === u.phone) throw E.bad('That is already your number.');
  const pol = P.config().phoneChange;
  if (u.role === 'tenant' && pol === 'staff_only') throw E.forbidden('Please ask your landlord or manager to change your phone number.');
  const taken = db.users.find('phone', b.phone);
  if (taken && taken.id !== u.id) {
    const releasable = taken.role === 'tenant' && !db.leases.where('tenantId', taken.id).some((l) => l.status === 'active');
    if (!releasable) throw E.conflict('That number cannot be used. Try another number or contact your landlord.', 'duplicate');
  }
  const sms = smsFor(u);
  if (u.role === 'tenant' && (pol === 'approval' || !sms)) {
    db.users.update(u.id, { phoneRequest: { phone: b.phone, status: 'pending', at: Date.now() } });
    D.notifyOrg(u.ownerId, u.propertyId, 'Tenant phone change', `${u.name} asked to change their number to ${b.phone}. Please approve or decline in Tenants.`, 'info', '#/tenants/' + u.id);
    D.audit(ctx, 'account.phone_change_requested', 'user', u.id, { mode: 'approval' });
    return { mode: 'approval', message: 'Request sent. Your landlord or manager must approve the new number. You can keep using your old number until then.' };
  }
  if (!sms) { // staff accounts without any SMS service: password is the proof
    core.releaseFormer(b.phone, null, u.id);
    db.users.update(u.id, { phone: b.phone, phoneChangedAt: Date.now() }); D.audit(ctx, 'account.phone_changed', 'user', u.id, { mode: 'direct' });
    return { mode: 'direct', phone: b.phone, message: 'Phone number changed.' };
  }
  const code = String(require('crypto').randomInt(100000, 1000000));
  db.users.update(u.id, { phoneChange: { phone: b.phone, codeHash: sec.sha256(code + ':' + u.id), exp: Date.now() + 10 * 60e3, tries: 0 } });
  const sent = await gw.sendSms(sms, b.phone, `Jasmyle Properties code ${code}. Use it to confirm your new phone number. Valid 10 minutes. Never share it.`);
  if (!sent) { db.users.update(u.id, { phoneChange: null }); throw E.unavailable('We could not send the SMS code just now. Please try again, or ask your landlord to change the number.'); }
  D.audit(ctx, 'account.phone_change_code_sent', 'user', u.id, {});
  return { mode: 'otp', message: 'We sent a 6-digit code to your new number. Enter it below.' };
});
H.route('POST', '/api/me/phone/confirm', { rate: [10, 3600000] }, async (ctx) => {
  const gw = require('../gateways'); const core = require('./core');
  const b = clean(ctx.body, { code: { t: 's', req: true, max: 8, re: /^\d{4,8}$/ } });
  const u = ctx.user; const pc = u.phoneChange;
  if (!pc || pc.exp < Date.now()) throw E.bad('That code has expired. Start again.');
  if (pc.tries >= 5) { db.users.update(u.id, { phoneChange: null }); throw E.bad('Too many wrong codes. Start again.'); }
  if (sec.sha256(b.code + ':' + u.id) !== pc.codeHash) { db.users.update(u.id, { phoneChange: { ...pc, tries: pc.tries + 1 } }); throw E.bad('That code is not correct.'); }
  core.releaseFormer(pc.phone, null, u.id);
  const old = u.phone;
  const up = db.users.update(u.id, { phone: pc.phone, phoneChange: null, phoneRequest: null, phoneChangedAt: Date.now() });
  if (old) { const sms = smsFor(u); if (sms) gw.sendSms(sms, old, 'Your Jasmyle Properties phone number was just changed. If this was not you, contact your landlord at once.').catch(() => {}); }
  D.audit(ctx, 'account.phone_changed', 'user', u.id, { mode: 'otp' });
  return { phone: up.phone, message: 'Your phone number has been changed. Use the new number to sign in.' };
});

module.exports = { createSession, killSessions, meView, withCookie };
