'use strict';
// Tiny HTTP framework: router, security headers, rate limiting ("application firewall"), CSRF, static files.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const cfg = require('./config');
const { HttpError, E, log } = require('./util');
const R = require('./roles');
const S = require('./store');

const routes = [];
function route(method, pattern, opts, handler) {
  if (typeof opts === 'function') { handler = opts; opts = {}; }
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([A-Za-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, opts, handler, pattern });
}

/* ---------- rate limiting (fixed windows, in memory) ---------- */
const buckets = new Map();
function hit(key, max, windowMs) {
  if (process.env.NH_TEST_NO_RATELIMIT === '1') return 0; // test-suite switch only
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset <= now) { b = { n: 0, reset: now + windowMs }; buckets.set(key, b); }
  b.n++;
  return b.n > max ? Math.ceil((b.reset - now) / 1000) : 0; // 0 = fine, else seconds to wait
}
function limit(key, max, windowMs, msg) {
  const wait = hit(key, max, windowMs);
  if (wait) { const e = E.tooMany(msg); e.extra = { retryAfter: wait }; throw e; }
}
setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (b.reset <= now) buckets.delete(k); }, 60000).unref();

/* ---------- client info ---------- */
const isLoopback = (a) => a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
function trustedPeer(remote) {
  if (!cfg.trustProxy) return false;
  if (isLoopback(remote)) return true;
  const r = String(remote).replace(/^::ffff:/, '');
  return cfg.trustedProxies.some((t) => t === 'any' || t === '*' || r === t || (/[.:]$/.test(t) && r.startsWith(t)));
}
function clientIp(req) {
  const remote = req.socket.remoteAddress || '';
  if (trustedPeer(remote)) { // only trust proxy headers from a proxy on this machine (or one you listed in trustedProxies)
    const cf = req.headers['cf-connecting-ip'];
    if (cf) return String(cf).trim();
    const xff = req.headers['x-forwarded-for'];
    if (xff) { const parts = String(xff).split(',').map((s) => s.trim()).filter(Boolean); if (parts.length) return parts[parts.length - 1]; }
  }
  return remote.replace(/^::ffff:/, '');
}
function isSecure(req) {
  if (req.socket.encrypted) return true;
  const remote = req.socket.remoteAddress || '';
  if (trustedPeer(remote)) {
    if (String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https') return true;
    if (/"scheme":"https"/.test(req.headers['cf-visitor'] || '')) return true;
  }
  return false;
}
function ipAllowed(ip, list) {
  if (!list.length) return true;
  return list.some((a) => (a.endsWith('.') || a.endsWith(':') ? ip.startsWith(a) : ip === a));
}
function parseCookies(h) {
  const out = {};
  for (const part of String(h || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/* ---------- responses ---------- */
function baseHeaders(req, secure) {
  const h = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src https://www.youtube.com https://player.vimeo.com https://my.matterport.com https://kuula.co; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  };
  if (secure) h['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return h;
}
/* ---------- compression (gzip) and metrics ---------- */
const M = { started: Date.now(), total: 0, inflight: 0, s2xx: 0, s3xx: 0, s4xx: 0, s5xx: 0, slow: 0, ms: 0, bytesOut: 0, perRoute: new Map() };
const metrics = () => ({ total: M.total, inflight: M.inflight, ok: M.s2xx, redirects: M.s3xx, clientErrors: M.s4xx, serverErrors: M.s5xx, slowOver2s: M.slow, avgMs: M.total ? Math.round(M.ms / M.total) : 0, megabytesOut: Math.round(M.bytesOut / 1048.576) / 1000, top: [...M.perRoute.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 12).map(([k, v]) => ({ route: k, calls: v.n, avgMs: Math.round(v.ms / v.n), errors: v.err })) });
const wantsGzip = (req) => /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''));
const COMPRESSIBLE = /^(application\/json|text\/|image\/svg|application\/javascript|application\/manifest)/;
function sendJson(res, status, data, extra) {
  let body = Buffer.from(JSON.stringify(data)); const h = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding', ...(extra || {}) };
  if (body.length > 1024 && res.req && wantsGzip(res.req)) { body = zlib.gzipSync(body, { level: 5 }); h['Content-Encoding'] = 'gzip'; }
  h['Content-Length'] = body.length; M.bytesOut += body.length;
  res.writeHead(status, h);
  res.end(body);
}

/* ---------- body reading ---------- */
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > max) { req.resume(); return reject(new HttpError(413, 'That file or request is too large', 'too_large')); }
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { req.destroy(); return reject(new HttpError(413, 'That file or request is too large', 'too_large')); }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* ---------- static files ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };
const gzCache = new Map();
function serveStatic(req, res, pathname, hdrs) {
  let rel = decodeURIComponent(pathname);
  if (rel.includes('\0')) throw E.bad('Bad path');
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(cfg.paths.public, rel));
  if (!file.startsWith(cfg.paths.public + path.sep)) throw E.notFound();
  let st;
  try { st = fs.statSync(file); } catch { throw E.notFound(); }
  if (!st.isFile()) throw E.notFound();
  const etag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
  const ext = path.extname(file).toLowerCase();
  const h = { ...hdrs, 'Content-Type': MIME[ext] || 'application/octet-stream', ETag: etag, 'Cache-Control': 'no-cache' };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, h); return res.end(); }
  if (COMPRESSIBLE.test(h['Content-Type']) && st.size > 1024 && wantsGzip(req)) {
    let z = gzCache.get(file);
    if (!z || z.etag !== etag) { z = { etag, buf: zlib.gzipSync(fs.readFileSync(file), { level: 9 }) }; if (gzCache.size > 200) gzCache.clear(); gzCache.set(file, z); }
    h['Content-Encoding'] = 'gzip'; h.Vary = 'Accept-Encoding'; h['Content-Length'] = z.buf.length; M.bytesOut += z.buf.length;
    res.writeHead(200, h);
    return req.method === 'HEAD' ? res.end() : res.end(z.buf);
  }
  h['Content-Length'] = st.size; M.bytesOut += st.size;
  res.writeHead(200, h);
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

/* ---------- main handler ---------- */
let sessionLoader = null; // set by auth.js
const setSessionLoader = (fn) => { sessionLoader = fn; };
let guard = null; const setGuard = (fn) => { guard = fn; };

async function handle(req, res) {
  const t0 = Date.now(); const rid = crypto.randomBytes(6).toString('hex'); res.req = req; res.setHeader('X-Request-Id', rid);
  M.total++; M.inflight++;
  res.on('close', () => {
    M.inflight--; const ms = Date.now() - t0; M.ms += ms; const c = res.statusCode;
    if (c >= 500) M.s5xx++; else if (c >= 400) M.s4xx++; else if (c >= 300) M.s3xx++; else M.s2xx++;
    if (ms > 2000 && !/\/api\/files\//.test(req.url || '')) { M.slow++; log('warn', 'Slow request', { id: rid, ms, method: req.method, path: String(req.url || '').split('?')[0] }); }
    if (req.url && req.url.startsWith('/api/') && res.routeKey) { const k = res.routeKey; const e = M.perRoute.get(k) || { n: 0, ms: 0, err: 0 }; e.n++; e.ms += ms; if (c >= 500) e.err++; if (M.perRoute.size < 400 || M.perRoute.has(k)) M.perRoute.set(k, e); }
  });
  return handleInner(req, res, rid);
}
async function handleInner(req, res, rid) {
  const ip = clientIp(req);
  const secure = isSecure(req);
  const hdrs = baseHeaders(req, secure);
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { res.writeHead(400, hdrs); return res.end('Bad request'); }
  const pathname = url.pathname;
  const isApi = pathname.startsWith('/api/');
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, hdrs); return res.end(); } // no CORS: same-origin only
    if (!isApi) {
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
      limit('static:' + ip, 600, 60000);
      return serveStatic(req, res, pathname, hdrs);
    }
    // firewall layer 1: per-IP flood protection
    limit('ip:' + ip, 300, 60000);
    const r = routes.find((x) => x.method === req.method && x.re.test(pathname));
    if (!r) throw E.notFound('Unknown API endpoint');
    res.routeKey = req.method + ' ' + r.pattern;
    const m = pathname.match(r.re);
    const params = {};
    r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    if (r.opts.rate) limit(`${r.pattern}:${ip}`, r.opts.rate[0], r.opts.rate[1]);

    const ctx = {
      req, res, ip, secure, params, query: Object.fromEntries(url.searchParams), body: null, rawBody: null,
      user: null, session: null, scope: null, headers: hdrs,
      cookies: parseCookies(req.headers.cookie),
      json: (data, status = 200, extra) => { ctx.sent = true; sendJson(res, status, data, { ...hdrs, ...(extra || {}) }); },
      send: (status, buf, extra) => { ctx.sent = true; res.writeHead(status, { ...hdrs, 'Content-Length': buf.length, ...(extra || {}) }); res.end(buf); },
      redirect: (loc) => { ctx.sent = true; res.writeHead(302, { ...hdrs, Location: loc, 'Cache-Control': 'no-store' }); res.end(); },
    };

    // authentication
    if (sessionLoader) await sessionLoader(ctx);
    if (!r.opts.public && !ctx.user) throw E.unauth();
    if (guard) guard(ctx, r);

    // firewall layer 2: CSRF + same-origin check for state-changing calls
    if (!['GET', 'HEAD'].includes(req.method) && !r.opts.noCsrf) {
      const origin = req.headers.origin;
      if (origin) {
        let ok = false;
        try { ok = new URL(origin).host === req.headers.host; } catch { /* ignore */ }
        if (!ok) throw new HttpError(403, 'Blocked: request came from another website', 'csrf');
      }
      if (ctx.user && !crypto.timingSafeEqual(crypto.createHash('sha256').update(String(req.headers['x-csrf-token'] || '')).digest(), crypto.createHash('sha256').update(ctx.session.csrf).digest())) {
        throw new HttpError(403, 'Your session security token is missing. Please refresh the page.', 'csrf');
      }
    }

    // firewall layer 3: role & permission gate (deny by default)
    if (ctx.user) {
      ctx.scope = R.scopeOf(ctx.user);
      const need = r.opts.perm ? [r.opts.perm] : r.opts.anyPerm || null;
      if (need && !need.some((p) => R.can(ctx.user, p))) {
        try { S.audit.append({ owner: ctx.user.ownerId || null, actor: ctx.user.id, role: ctx.user.role, action: 'security.denied', entity: 'route', entityId: `${req.method} ${r.pattern}`, ip }); } catch { /* ignore */ }
        throw E.forbidden();
      }
      if (r.opts.roles && !r.opts.roles.includes(ctx.user.role)) throw E.forbidden();
      // account gates: must change temp password / national admins must enrol 2FA first
      if (!r.opts.skipGate) {
        if (ctx.user.mustChangePassword) throw new HttpError(403, 'Please set a new password first', 'must_change_password');
        if (ctx.user.role === 'national_admin' && !(ctx.user.totp && ctx.user.totp.enabled)) throw new HttpError(403, 'Please set up two-factor authentication first', 'mfa_setup_required');
      }
    }

    // body
    if (!['GET', 'HEAD', 'DELETE'].includes(req.method)) {
      const max = r.opts.raw ? Math.max(cfg.limits.image, cfg.limits.doc, cfg.limits.video) : cfg.limits.json;
      const buf = await readBody(req, r.opts.rawMax || max);
      if (r.opts.raw) ctx.rawBody = buf;
      else if (buf.length) {
        try { ctx.body = JSON.parse(buf.toString('utf8')); } catch { throw E.bad('Request is not valid JSON'); }
      }
    }
    const out = await r.handler(ctx);
    if (!ctx.sent) ctx.json(out === undefined ? { ok: true } : out);
  } catch (e) {
    if (res.headersSent) { try { res.end(); } catch { /* ignore */ } return; }
    if (e instanceof HttpError) {
      const extra = e.extra && e.extra.retryAfter ? { 'Retry-After': String(e.extra.retryAfter) } : {};
      if (isApi) return sendJson(res, e.status, { error: e.message, code: e.code, ...(e.extra && !e.extra.retryAfter ? e.extra : {}) }, { ...hdrs, ...extra });
      res.writeHead(e.status, { ...hdrs, 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(e.status === 404 ? 'Not found' : e.message);
    }
    log('error', 'Unhandled error', { path: pathname, err: String(e && e.stack || e).slice(0, 1500) });
    if (isApi) return sendJson(res, 500, { error: 'Something went wrong on the server. Please try again.', code: 'server_error' }, hdrs);
    res.writeHead(500, hdrs); res.end('Server error');
  }
}

module.exports = { metrics, route, handle, limit, hit, clientIp, isSecure, ipAllowed, setSessionLoader, setGuard, sendJson, routes, parseCookies };
