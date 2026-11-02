'use strict';
// SQLite-backed document store (built-in node:sqlite - no native modules to compile).
// WAL + synchronous=FULL means a power cut can never corrupt or half-write a payment.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const cfg = require('./config');
const { newId, E, log } = require('./util');

const J = (f) => `json_extract(data,'$.${f}')`;

// name -> { prefix, indexes:[jsonFields], uniques:[{name, cols, where, msg}] }
const DEFS = {
  users: {
    prefix: 'usr', indexes: ['role', 'phone'],
    uniques: [
      // empty strings are ignored (only real values must be unique); older databases get the new rules via `drop`
      { name: 'uq_users_email2', drop: 'uq_users_email', cols: J('email'), where: `${J('email')} IS NOT NULL AND ${J('email')} != ''`, msg: 'That email address is already registered.' },
      { name: 'uq_users_phone2', drop: 'uq_users_phone', cols: J('phone'), where: `${J('phone')} IS NOT NULL AND ${J('phone')} != ''`, msg: 'That phone number is already used by another account. Use a different number, or sign in if it is yours.' },
    ],
  },
  properties: { prefix: 'prp', indexes: ['verified', 'county', 'status'] },
  units: {
    prefix: 'unt', indexes: ['status', 'listed'],
    uniques: [{ name: 'uq_units_name', cols: `prop, lower(${J('name')})`, where: `${J('archived')} IS NOT 1`, msg: 'A unit with that name already exists in this property.' }],
  },
  leases: { prefix: 'lse', indexes: ['tenantId', 'unitId', 'status'] },
  invoices: {
    prefix: 'inv', indexes: ['leaseId', 'tenantId', 'status', 'period', 'payRef'],
    uniques: [{ name: 'uq_inv_period', cols: `${J('leaseId')}, ${J('period')}`, where: `${J('type')} = 'rent'`, msg: 'Rent for that month has already been invoiced.' }],
  },
  payments: {
    prefix: 'pay', indexes: ['invoiceId', 'tenantId', 'providerRef', 'status', 'tokenHash', 'checkoutRequestId', 'paypalOrderId'],
    uniques: [{ name: 'uq_pay_ref', cols: `owner, ${J('providerRef')}`, where: `${J('providerRef')} IS NOT NULL`, msg: 'That transaction code has already been used.' }],
  },
  expenses: { prefix: 'exp', indexes: ['date'] },
  maintenance: { prefix: 'mnt', indexes: ['status', 'tenantId', 'contractorId'] },
  contractors: { prefix: 'ctr', indexes: [] },
  inspections: { prefix: 'ins', indexes: [] },
  messages: { prefix: 'msg', indexes: ['fromId', 'toId'] },
  notifications: { prefix: 'ntf', indexes: ['userId'] },
  files: { prefix: 'fil', indexes: ['refId'] },
  inquiries: { prefix: 'inq', indexes: [] },
  settings: { prefix: 'set', indexes: [] },
  sessions: { prefix: 'ses', indexes: ['userId', 'tokenHash'] },
  plat_invoices: { prefix: 'pin', indexes: ['status', 'period'], uniques: [{ name: 'uq_plat_period', cols: `owner, ${J('period')}`, where: `${J('period')} IS NOT NULL`, msg: 'That month has already been billed.' }] },
  plat_payments: { prefix: 'ppy', indexes: ['invoiceId', 'status', 'tokenHash', 'checkoutRequestId', 'paypalOrderId'] },
  viewings: { prefix: 'vwg', indexes: ['status', 'tokenHash', 'unitId'] },
  alerts: { prefix: 'alt', indexes: ['phone', 'tokenHash'] },
  readings: {
    prefix: 'rdg', indexes: ['unitId', 'period'],
    uniques: [{ name: 'uq_reading', cols: `${J('unitId')}, ${J('utility')}, ${J('period')}`, where: `${J('period')} IS NOT NULL`, msg: 'A reading for that month already exists for this unit.' }],
  },
  // ---- real-estate ecosystem (v7) ----
  sales: { prefix: 'sal', indexes: ['status', 'verified', 'kind', 'county'] },
  leads: { prefix: 'led', indexes: ['stage', 'phone'] },
  deals: { prefix: 'dea', indexes: ['status', 'leadId', 'saleId'] },
  stays: { prefix: 'sty', indexes: ['unitId', 'status', 'checkIn'] },
  projects: { prefix: 'pjt', indexes: ['status'] },
  assets: { prefix: 'ast', indexes: ['nextService'] },
  compliance: { prefix: 'cmp', indexes: ['expires', 'kind'] },
  providers: { prefix: 'prv', indexes: ['status', 'category', 'county'] },
  service_requests: { prefix: 'srq', indexes: ['providerId', 'status'] },
  consents: { prefix: 'cns', indexes: ['userId', 'subject', 'purpose'] },
  dsr: { prefix: 'dsr', indexes: ['status', 'userId'] },
  etims: { prefix: 'etm', indexes: ['status'], uniques: [{ name: 'uq_etims_pay', cols: `owner, ${J('paymentId')}`, where: `${J('paymentId')} IS NOT NULL`, msg: 'Already queued.' }] },
};

let db = null;
let depth = 0;
const cols = {};
let lastAuditHash = 'GENESIS';

/* ---------- open / recover ---------- */
function newestBackup() {
  try {
    const fl = fs.readdirSync(cfg.paths.backups).filter((f) => /^jasmyle-.*\.db$/.test(f)).sort();
    return fl.length ? path.join(cfg.paths.backups, fl[fl.length - 1]) : null;
  } catch { return null; }
}
function tryOpen(file) {
  const d = new DatabaseSync(file);
  const r = d.prepare('PRAGMA quick_check').get();
  if (!r || Object.values(r)[0] !== 'ok') { try { d.close(); } catch { /* ignore */ } throw new Error('integrity check failed'); }
  return d;
}
function open() {
  if (db) return db;
  for (const p of [cfg.paths.data, cfg.paths.files, cfg.paths.backups, cfg.paths.logs]) fs.mkdirSync(p, { recursive: true });
  try {
    db = tryOpen(cfg.paths.db);
  } catch (e) {
    log('error', 'Database problem detected: ' + e.message);
    if (fs.existsSync(cfg.paths.db)) {
      fs.renameSync(cfg.paths.db, cfg.paths.db + '.corrupt-' + Date.now());
      for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(cfg.paths.db + ext); } catch { /* ignore */ } }
      const bk = newestBackup();
      if (bk) { fs.copyFileSync(bk, cfg.paths.db); log('warn', 'Restored the database from backup ' + path.basename(bk)); }
    }
    db = tryOpen(cfg.paths.db);
  }
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA temp_store=MEMORY; PRAGMA cache_size=-65536; PRAGMA mmap_size=268435456; PRAGMA wal_autocheckpoint=2000;');
  db.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)');
  for (const [name, def] of Object.entries(DEFS)) {
    const T = 'c_' + name;
    db.exec(`CREATE TABLE IF NOT EXISTS ${T} (id TEXT PRIMARY KEY, owner TEXT, prop TEXT, ver INTEGER NOT NULL, created INTEGER NOT NULL, data TEXT NOT NULL)`);
    db.exec(`CREATE INDEX IF NOT EXISTS i_${name}_owner ON ${T}(owner)`);
    db.exec(`CREATE INDEX IF NOT EXISTS i_${name}_prop ON ${T}(prop)`);
    for (const f of def.indexes) db.exec(`CREATE INDEX IF NOT EXISTS i_${name}_${f} ON ${T}(${J(f)})`);
    for (const u of def.uniques || []) { if (u.drop) db.exec(`DROP INDEX IF EXISTS ${u.drop}`); db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${u.name} ON ${T}(${u.cols}) WHERE ${u.where}`); }
    cols[name] = makeCol(name, def);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS audit (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, owner TEXT, actor TEXT, role TEXT,
    action TEXT NOT NULL, entity TEXT, entity_id TEXT, ip TEXT, detail TEXT, prev TEXT NOT NULL, hash TEXT NOT NULL)`);
  db.exec('CREATE INDEX IF NOT EXISTS i_audit_owner ON audit(owner, seq)');
  db.exec('CREATE INDEX IF NOT EXISTS i_audit_actor ON audit(actor, seq)');
  db.exec(`CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'audit log is append-only'); END`);
  db.exec(`CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'audit log is append-only'); END`);
  const last = db.prepare('SELECT hash FROM audit ORDER BY seq DESC LIMIT 1').get();
  lastAuditHash = last ? last.hash : 'GENESIS';
  return db;
}
function close() { if (db) { try { db.close(); } catch { /* ignore */ } db = null; } }

/* ---------- transactions (callback must be synchronous) ---------- */
function tx(fn) {
  if (depth > 0) return fn();
  db.exec('BEGIN IMMEDIATE');
  depth = 1;
  try {
    const r = fn();
    if (r && typeof r.then === 'function') throw new Error('tx() callback must be synchronous');
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  } finally { depth = 0; }
}

/* ---------- collections ---------- */
function mapDbError(e, def) {
  const m = String(e && e.message || '');
  if (/UNIQUE constraint failed/i.test(m)) {
    const hit = (def.uniques || []).find((u) => m.includes(u.name));   // SQLite names the exact index: "index 'uq_users_phone2'"
    if (hit) return E.conflict(hit.msg, 'duplicate');
    return E.conflict('That record already exists.', 'duplicate');
  }
  return e;
}
const FIELD_RE = /^[A-Za-z][A-Za-z0-9]*$/;

function makeCol(name, def) {
  const T = 'c_' + name;
  const cache = {};
  const st = (k, sql) => cache[k] || (cache[k] = db.prepare(sql));
  const parse = (r) => (r ? JSON.parse(r.data) : null);
  const parseAll = (rows) => rows.map((r) => JSON.parse(r.data));
  const c = {
    name,
    get: (id) => (typeof id === 'string' ? parse(st('get', `SELECT data FROM ${T} WHERE id=?`).get(id)) : null),
    all: () => parseAll(st('all', `SELECT data FROM ${T}`).all()),
    byOwner: (o) => parseAll(st('byOwner', `SELECT data FROM ${T} WHERE owner=?`).all(o)),
    byProp: (p) => parseAll(st('byProp', `SELECT data FROM ${T} WHERE prop=?`).all(p)),
    count: () => st('count', `SELECT COUNT(*) AS n FROM ${T}`).get().n,
    where(field, value) {
      if (!FIELD_RE.test(field)) throw new Error('bad field');
      const v = value === true ? 1 : value === false ? 0 : value;
      return parseAll(st('w:' + field, `SELECT data FROM ${T} WHERE ${J(field)} = ?`).all(v));
    },
    find(field, value) { return this.where(field, value)[0] || null; },
    insert(obj) {
      const now = Date.now();
      const rec = { ...obj, id: obj.id || newId(def.prefix), version: 1, createdAt: obj.createdAt || now, updatedAt: now };
      try {
        st('ins', `INSERT INTO ${T}(id,owner,prop,ver,created,data) VALUES (?,?,?,?,?,?)`)
          .run(rec.id, rec.ownerId ?? null, rec.propertyId ?? null, 1, rec.createdAt, JSON.stringify(rec));
      } catch (e) { throw mapDbError(e, def); }
      return rec;
    },
    /** patch: object or function(record)->record. expectedVersion enforces optimistic locking. */
    update(id, patch, expectedVersion, opts = {}) {
      const row = st('row', `SELECT ver,data FROM ${T} WHERE id=?`).get(id);
      if (!row) throw E.notFound();
      if (expectedVersion !== undefined && expectedVersion !== null && row.ver !== expectedVersion) {
        throw E.conflict('Someone else changed this record while you were editing it. Reload to see the latest version, then try again.', 'version_conflict');
      }
      const cur = JSON.parse(row.data);
      const next = typeof patch === 'function' ? (patch({ ...cur }) || cur) : { ...cur, ...patch };
      next.id = cur.id; next.createdAt = cur.createdAt;
      if (!opts.allowOwnerChange) next.ownerId = cur.ownerId;
      next.version = row.ver + 1; next.updatedAt = Date.now();
      let r;
      try {
        r = st('upd', `UPDATE ${T} SET owner=?, prop=?, ver=?, data=? WHERE id=? AND ver=?`)
          .run(next.ownerId ?? null, next.propertyId ?? null, next.version, JSON.stringify(next), id, row.ver);
      } catch (e) { throw mapDbError(e, def); }
      if (r.changes === 0) throw E.conflict('This record was changed by someone else. Reload and try again.', 'version_conflict');
      return next;
    },
    remove: (id) => st('del', `DELETE FROM ${T} WHERE id=?`).run(id).changes,
    exec: (sql, ...p) => db.prepare(sql.replace(/\{T\}/g, T)).run(...p),
  };
  return c;
}
const col = (n) => { if (!cols[n]) throw new Error('unknown collection ' + n); return cols[n]; };
const proxy = new Proxy({}, { get: (_, n) => col(n) });

/* ---------- meta (counters, platform settings) ---------- */
const meta = {
  get(k, def = null) { const r = db.prepare('SELECT v FROM meta WHERE k=?').get(k); return r ? JSON.parse(r.v) : def; },
  set(k, v) { db.prepare('INSERT INTO meta(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').run(k, JSON.stringify(v)); },
  incr(k) { return tx(() => { const n = (this.get(k, 0) || 0) + 1; this.set(k, n); return n; }); },
};

/* ---------- tamper-evident audit trail (hash chain) ---------- */
function auditHash(prev, p) { return crypto.createHash('sha256').update(prev + '|' + JSON.stringify(p)).digest('hex'); }
const audit = {
  append({ owner = null, actor = null, role = null, action, entity = null, entityId = null, ip = null, detail = null }) {
    const ts = Date.now();
    const d = detail ? JSON.stringify(detail).slice(0, 2000) : null;
    const prev = lastAuditHash;
    const hash = auditHash(prev, [ts, owner, actor, role, action, entity, entityId, ip, d]);
    db.prepare('INSERT INTO audit(ts,owner,actor,role,action,entity,entity_id,ip,detail,prev,hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .run(ts, owner, actor, role, action, entity, entityId, ip, d, prev, hash);
    lastAuditHash = hash;
  },
  list({ owner, actor, action, before, limit = 100 } = {}) {
    const w = []; const p = [];
    if (owner) { w.push('owner=?'); p.push(owner); }
    if (actor) { w.push('actor=?'); p.push(actor); }
    if (action) { w.push('action LIKE ?'); p.push(String(action).replace(/[%_]/g, '') + '%'); }
    if (before) { w.push('seq<?'); p.push(Number(before)); }
    const rows = db.prepare(`SELECT seq,ts,owner,actor,role,action,entity,entity_id,ip,detail FROM audit ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY seq DESC LIMIT ?`)
      .all(...p, Math.min(Number(limit) || 100, 500));
    return rows.map((r) => ({ ...r, detail: r.detail ? JSON.parse(r.detail) : null }));
  },
  verify() {
    let prev = 'GENESIS', seq = 0, n = 0;
    for (;;) {
      const rows = db.prepare('SELECT * FROM audit WHERE seq>? ORDER BY seq LIMIT 5000').all(seq);
      if (!rows.length) break;
      for (const r of rows) {
        const h = auditHash(prev, [r.ts, r.owner, r.actor, r.role, r.action, r.entity, r.entity_id, r.ip, r.detail]);
        if (r.prev !== prev || r.hash !== h) return { ok: false, checked: n, brokenAt: r.seq };
        prev = r.hash; seq = r.seq; n++;
      }
    }
    return { ok: true, checked: n };
  },
};

/* ---------- backups ---------- */
function backup(label) {
  fs.mkdirSync(cfg.paths.backups, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
  const f = path.join(cfg.paths.backups, `jasmyle-${stamp}${label ? '-' + label : ''}.db`);
  if (fs.existsSync(f)) return f;
  db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`);
  const all = fs.readdirSync(cfg.paths.backups).filter((x) => /^jasmyle-.*\.db$/.test(x)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - cfg.backupsToKeep))) { try { fs.unlinkSync(path.join(cfg.paths.backups, old)); } catch { /* ignore */ } }
  return f;
}
function listBackups() {
  try {
    return fs.readdirSync(cfg.paths.backups).filter((x) => /^jasmyle-.*\.db$/.test(x)).sort().reverse()
      .map((f) => ({ name: f, size: fs.statSync(path.join(cfg.paths.backups, f)).size, at: fs.statSync(path.join(cfg.paths.backups, f)).mtimeMs }));
  } catch { return []; }
}

module.exports = { open, close, tx, col, db: proxy, meta, audit, backup, listBackups, DEFS, raw: () => db };
