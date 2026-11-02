'use strict';
const crypto = require('crypto');
const cfg = require('./config');

/* ---------- errors ---------- */
class HttpError extends Error {
  constructor(status, message, code, extra) {
    super(message);
    this.status = status;
    this.code = code || null;
    this.extra = extra || null;
  }
}
const E = {
  bad: (m, code) => new HttpError(400, m, code || 'bad_request'),
  unauth: (m = 'Please sign in') => new HttpError(401, m, 'unauthenticated'),
  forbidden: (m = 'You do not have permission to do this') => new HttpError(403, m, 'forbidden'),
  notFound: (m = 'Not found') => new HttpError(404, m, 'not_found'),
  conflict: (m, code) => new HttpError(409, m, code || 'conflict'),
  tooMany: (m = 'Too many requests. Please slow down and try again shortly.') => new HttpError(429, m, 'rate_limited'),
  unavailable: (m) => new HttpError(503, m, 'unavailable'),
};

/* ---------- ids ---------- */
const newId = (prefix) => prefix + '_' + crypto.randomBytes(9).toString('base64url');
const ID_RE = /^[a-z]{2,4}_[A-Za-z0-9_-]{8,40}$/;

/* ---------- validation ---------- */
const CTRL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

function normPhone(p) {
  let s = String(p || '').replace(/[\s\-().]/g, '');
  if (s.startsWith('+')) s = s.slice(1);
  if (/^0\d{9}$/.test(s)) s = '254' + s.slice(1);
  else if (/^[17]\d{8}$/.test(s)) s = '254' + s;
  return /^\d{9,15}$/.test(s) ? s : null;
}
const isKenyanMobile = (p) => /^254[17]\d{8}$/.test(p || '');

function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * clean(body, schema) -> only whitelisted, validated fields (mass-assignment safe).
 * rule: { t:'s|n|b|e|d|m|email|phone|id|ids|a', req, min, max, int, values, re, label, raw, def }
 */
function clean(input, schema) {
  if (input === undefined || input === null) input = {};
  if (typeof input !== 'object' || Array.isArray(input)) throw E.bad('Invalid request');
  const out = {};
  for (const [k, r] of Object.entries(schema)) {
    let v = input[k];
    const label = r.label || k;
    if (v === undefined || v === null || v === '') {
      if (r.req) throw E.bad(`${label} is required`, 'validation');
      if (r.def !== undefined) out[k] = r.def;
      continue;
    }
    switch (r.t) {
      case 's': {
        if (typeof v !== 'string') throw E.bad(`${label} must be text`, 'validation');
        if (!r.raw) v = v.replace(CTRL, '').trim();
        if (r.min && v.length < r.min) throw E.bad(`${label} is too short`, 'validation');
        if (v.length > (r.max || 200)) throw E.bad(`${label} is too long`, 'validation');
        if (r.re && !r.re.test(v)) throw E.bad(`${label} is not valid`, 'validation');
        if (r.req && !v) throw E.bad(`${label} is required`, 'validation');
        out[k] = v;
        break;
      }
      case 'n': {
        if (typeof v === 'string' && v.trim() !== '') v = Number(v);
        if (typeof v !== 'number' || !Number.isFinite(v)) throw E.bad(`${label} must be a number`, 'validation');
        if (r.int && !Number.isInteger(v)) throw E.bad(`${label} must be a whole number`, 'validation');
        if (v < (r.min ?? 0)) throw E.bad(`${label} must be at least ${r.min ?? 0}`, 'validation');
        if (v > (r.max ?? 1e9)) throw E.bad(`${label} is too large`, 'validation');
        out[k] = v;
        break;
      }
      case 'b': out[k] = v === true || v === 'true' || v === 1 || v === '1'; break;
      case 'e':
        if (!r.values.includes(v)) throw E.bad(`${label} is not valid`, 'validation');
        out[k] = v;
        break;
      case 'd':
        if (!isDate(v)) throw E.bad(`${label} must be a date (YYYY-MM-DD)`, 'validation');
        out[k] = v;
        break;
      case 'm':
        if (typeof v !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw E.bad(`${label} must be a month (YYYY-MM)`, 'validation');
        out[k] = v;
        break;
      case 'email': {
        if (typeof v !== 'string') throw E.bad(`${label} is not valid`, 'validation');
        v = v.trim().toLowerCase();
        if (!EMAIL_RE.test(v) || v.length > 254) throw E.bad(`${label} is not a valid email address`, 'validation');
        out[k] = v;
        break;
      }
      case 'phone': {
        const p = normPhone(v);
        if (!p) throw E.bad(`${label} is not a valid phone number`, 'validation');
        out[k] = p;
        break;
      }
      case 'id':
        if (typeof v !== 'string' || !ID_RE.test(v)) throw E.bad(`${label} is not valid`, 'validation');
        out[k] = v;
        break;
      case 'ids': {
        if (!Array.isArray(v) || v.length > (r.max || 500) || v.some((x) => typeof x !== 'string' || !ID_RE.test(x))) throw E.bad(`${label} is not valid`, 'validation');
        out[k] = [...new Set(v)];
        break;
      }
      case 'strs': {
        if (!Array.isArray(v) || v.length > (r.max || 30)) throw E.bad(`${label} is not valid`, 'validation');
        out[k] = v.map((x) => String(x).replace(CTRL, '').trim().slice(0, 60)).filter(Boolean);
        break;
      }
      default: throw new Error('unknown rule ' + r.t);
    }
  }
  return out;
}

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);

/* ---------- dates (all business dates are in the configured timezone) ---------- */
function todayStr() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: cfg.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function dateOf(ts) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: cfg.timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));
}
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
const monthOf = (s) => s.slice(0, 7);
function addMonths(ym, n) {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
const daysInMonth = (ym) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).getUTCDate(); };
const dueDateFor = (period, dueDay) => `${period}-${String(Math.min(dueDay, daysInMonth(period))).padStart(2, '0')}`;
const lastMonths = (n, from) => { const cur = monthOf(from || todayStr()); return Array.from({ length: n }, (_, i) => addMonths(cur, i - (n - 1))); };

/* ---------- misc ---------- */
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

function log(level, msg, extra) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(extra || {}) });
  (level === 'error' ? process.stderr : process.stdout).write(line + '\n');
}

module.exports = {
  HttpError, E, newId, ID_RE, clean, pick, sum, normPhone, isKenyanMobile, isDate,
  todayStr, dateOf, addDays, daysBetween, monthOf, addMonths, daysInMonth, dueDateFor, lastMonths,
  csvCell, toCsv, log,
};
