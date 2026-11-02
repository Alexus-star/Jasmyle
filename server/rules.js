'use strict';
// Updatable "rules pack": tax rates/thresholds and provider endpoints (Safaricom, PayPal, KRA eTIMS) live in DATA,
// not code, so they can be changed without a new release when KRA or Safaricom change a rate, URL or path.
// A pack can be (a) edited by the super administrator, (b) imported as a file, or (c) pulled from a feed URL.
// Imported/fetched packs MUST carry an Ed25519 signature that verifies against the public key the super
// administrator saved - so nobody can feed the system fake tax rates or payment endpoints.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const S = require('./store');
const { log } = require('./util');

const DEFAULT = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'rules-default.json'), 'utf8'));
const isObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
function merge(a, b) {
  if (!isObj(a) || !isObj(b)) return b === undefined ? a : b;
  const o = { ...a };
  for (const k of Object.keys(b)) { if (k === '__proto__' || k === 'constructor') continue; o[k] = isObj(a[k]) && isObj(b[k]) ? merge(a[k], b[k]) : b[k]; }
  return o;
}
let cache = null;
const active = () => S.meta.get('rules:active', null);
function all() { if (!cache) { const a = active(); cache = a ? merge(DEFAULT, a.data) : DEFAULT; if (a) cache = { ...cache, version: a.version, issuedAt: a.issuedAt }; } return cache; }
function get(p, def) { let v = all(); for (const k of String(p).split('.')) { if (v === undefined || v === null) return def; v = v[k]; } return v === undefined ? def : v; }
function reset() { cache = null; }

const canon = (v) => (Array.isArray(v) ? '[' + v.map(canon).join(',') + ']' : isObj(v) ? '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}' : JSON.stringify(v));
const payload = (pack) => canon({ version: pack.version, issuedAt: pack.issuedAt, data: pack.data });
function verifyPack(pack) {
  const key = S.meta.get('rules:pubkey', '');
  if (!key) return { ok: false, why: 'No publisher key saved yet. Save the public key of whoever signs your rules packs first.' };
  try {
    const pub = crypto.createPublicKey({ key: Buffer.from(key, 'base64'), format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.from(payload(pack)), pub, Buffer.from(String(pack.sig || ''), 'base64')) ? { ok: true } : { ok: false, why: 'Signature does not match - pack rejected.' };
  } catch { return { ok: false, why: 'Signature or key could not be read.' }; }
}
const SAFE_KEYS = new Set(['tax', 'integrations']);
function sanitize(data) {
  if (!isObj(data)) throw new Error('Pack has no data');
  const out = {};
  for (const k of Object.keys(data)) if (SAFE_KEYS.has(k)) out[k] = data[k];
  // payment/KRA endpoints must be https and on known provider domains
  const okHost = /^https:\/\/([a-z0-9-]+\.)*(safaricom\.co\.ke|paypal\.com|kra\.go\.ke)(\/|$)/i;
  for (const g of Object.values((out.integrations) || {})) for (const [k, v] of Object.entries(g)) if (typeof v === 'string' && /^https?:/i.test(v) && !okHost.test(v)) throw new Error('Endpoint not allowed: ' + v);
  return out;
}
function install(pack, { by = 'system', signed = true } = {}) {
  if (signed) { const v = verifyPack(pack); if (!v.ok) throw new Error(v.why); }
  const cur = all();
  if (signed && String(pack.version) <= String(cur.version)) throw new Error(`Pack ${pack.version} is not newer than the current ${cur.version}.`);
  const data = sanitize(pack.data);
  const hist = S.meta.get('rules:history', []);
  hist.unshift({ version: pack.version, at: Date.now(), by, signed, prev: active() });
  S.meta.set('rules:history', hist.slice(0, 20));
  S.meta.set('rules:active', { version: pack.version, issuedAt: pack.issuedAt || new Date().toISOString().slice(0, 10), data, signed });
  reset();
  return all();
}
function rollback() {
  const hist = S.meta.get('rules:history', []);
  if (!hist.length) throw new Error('Nothing to roll back to.');
  const h = hist.shift(); S.meta.set('rules:history', hist);
  if (h.prev) S.meta.set('rules:active', h.prev); else S.db && S.raw().prepare('DELETE FROM meta WHERE k=?').run('rules:active');
  reset(); return all();
}
async function checkFeed() {
  const url = S.meta.get('rules:feed', '');
  if (!url) return { ok: false, skipped: true };
  const res = { at: Date.now(), url };
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { Accept: 'application/json' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const pack = await r.json();
    if (String(pack.version) > String(all().version)) { install(pack, { by: 'feed' }); res.updated = pack.version; log('info', 'Rules pack updated from feed', { version: pack.version }); } else res.updated = null;
    res.ok = true;
  } catch (e) { res.ok = false; res.error = e.message; log('warn', 'Rules feed check failed: ' + e.message); }
  S.meta.set('rules:feedStatus', res);
  return res;
}
module.exports = { get, all, DEFAULT, install, rollback, verifyPack, checkFeed, reset, canon, payload };
