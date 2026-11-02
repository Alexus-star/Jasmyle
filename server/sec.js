'use strict';
// Cryptography helpers: password hashing, field/file encryption, TOTP (2FA), password policy.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const cfg = require('./config');

const scrypt = promisify(crypto.scrypt);

/* ---------- master key (stored in data/secret.key, never leaves the laptop) ---------- */
let MASTER = null;
const SUB = {};
function master() {
  if (MASTER) return MASTER;
  fs.mkdirSync(cfg.paths.data, { recursive: true });
  const f = path.join(cfg.paths.data, 'secret.key');
  if (!fs.existsSync(f)) fs.writeFileSync(f, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  MASTER = Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex');
  if (MASTER.length !== 32) throw new Error('data/secret.key is damaged. Restore it from your backup - encrypted data cannot be read without it.');
  return MASTER;
}
function subkey(label) {
  if (!SUB[label]) SUB[label] = Buffer.from(crypto.hkdfSync('sha256', master(), Buffer.alloc(0), 'jasmyle:' + label, 32));
  return SUB[label];
}

/* ---------- passwords ---------- */
const SC = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, SC);
  return ['scrypt', SC.N, SC.r, SC.p, salt.toString('base64'), key.toString('base64')].join('$');
}
async function verifyPassword(pw, stored) {
  try {
    const [alg, N, r, p, s, h] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const want = Buffer.from(h, 'base64');
    const got = await scrypt(pw, Buffer.from(s, 'base64'), want.length, { N: +N, r: +r, p: +p, maxmem: SC.maxmem });
    return crypto.timingSafeEqual(want, got);
  } catch { return false; }
}
let DUMMY = null;
async function dummyVerify(pw) { // keeps response time similar when the account does not exist
  if (!DUMMY) DUMMY = await hashPassword('dummy-password-for-timing');
  await verifyPassword(pw, DUMMY);
}

const COMMON = new Set(['password', 'passw0rd', 'qwerty', 'qwertyuiop', 'letmein', 'welcome', 'admin', 'administrator', 'jasmyle',
  'changeme', 'iloveyou', 'kenya', 'nairobi', 'mombasa', 'safaricom', 'mpesa', 'landlord', 'tenant', 'house', 'rental', 'abc', 'monkey', 'dragon', 'football']);
function checkPassword(pw, ctx = {}) {
  if (typeof pw !== 'string') return 'Password is required';
  if (pw.length < 10) return 'Password must be at least 10 characters';
  if (pw.length > 128) return 'Password is too long';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes < 3) return 'Use a mix of at least 3 of: lowercase, UPPERCASE, numbers and symbols';
  const letters = pw.toLowerCase().replace(/[^a-z]/g, '');
  for (const c of COMMON) if (letters === c || (c.length >= 6 && letters.includes(c))) return 'That password is too easy to guess';
  if (/(.)\1{3,}/.test(pw)) return 'Avoid repeating the same character many times';
  const l = pw.toLowerCase();
  const bits = [(ctx.email || '').split('@')[0], ...(ctx.name || '').split(/\s+/)].map((x) => x.toLowerCase()).filter((x) => x.length >= 4);
  if (bits.some((b) => l.includes(b))) return 'Password must not contain your name or email';
  return null;
}
function genPassword() {
  const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', L = 'abcdefghijkmnopqrstuvwxyz', D = '23456789', S = '!@#$%&*?';
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(U), pick(U), pick(L), pick(L), pick(L), pick(L), pick(D), pick(D), pick(D), pick(S), pick(S)];
  const all = U + L + D;
  while (chars.length < 14) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

/* ---------- encryption at rest ---------- */
function encField(plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', subkey('field'), iv);
  const ct = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return 'v1.' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function decField(s) {
  if (!s) return '';
  try {
    const b = Buffer.from(String(s).replace(/^v1\./, ''), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', subkey('field'), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch { return ''; }
}
function encBuffer(buf, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', subkey('file'), iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
function decBuffer(buf, aad) {
  const d = crypto.createDecipheriv('aes-256-gcm', subkey('file'), buf.subarray(0, 12));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
}

/* ---------- tokens / hashing helpers ---------- */
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hmacHex = (key, data) => crypto.createHmac('sha256', key).update(data).digest('hex');
function safeEq(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/* ---------- TOTP (RFC 6238) for Google Authenticator / Microsoft Authenticator / Authy ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32enc(buf) {
  let bits = 0, val = 0, out = '';
  for (const byte of buf) {
    val = ((val << 8) | byte) & 0xffff; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}
function b32dec(s) {
  let bits = 0, val = 0; const out = [];
  for (const ch of s.replace(/=+$/, '').toUpperCase()) {
    const i = B32.indexOf(ch); if (i < 0) continue;
    val = ((val << 5) | i) & 0xffff; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function hotp(key, counter) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const o = h[19] & 15;
  const code = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(code % 1000000).padStart(6, '0');
}
const totpSecret = () => b32enc(crypto.randomBytes(20));
/** returns the matched time-step (so it can be stored to block replay) or null */
function totpCheck(secret, code, lastStep = 0) {
  if (!/^\d{6}$/.test(String(code || ''))) return null;
  const key = b32dec(secret);
  const now = Math.floor(Date.now() / 30000);
  for (let w = -1; w <= 1; w++) {
    const step = now + w;
    if (step <= lastStep) continue;
    if (safeEq(hotp(key, step), code)) return step;
  }
  return null;
}
const totpUri = (secret, label) => `otpauth://totp/${encodeURIComponent(cfg.appName)}:${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(cfg.appName)}&digits=6&period=30`;

module.exports = {
  master, subkey, hashPassword, verifyPassword, dummyVerify, checkPassword, genPassword,
  encField, decField, encBuffer, decBuffer, randomToken, sha256, hmacHex, safeEq,
  totpSecret, totpCheck, totpUri, hotp, b32dec,
};
