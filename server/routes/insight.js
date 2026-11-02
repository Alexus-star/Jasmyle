'use strict';
// Cross-module tools: global search, CSV exports for the new modules, and server metrics for National Administration.
const fs = require('fs');
const S = require('../store');
const { db } = S;
const U = require('../util');
const { E, clean } = U;
const H = require('../http');
const D = require('../domain');
const R = require('../roles');
const cfg = require('../config');

/* ---------- global search (always scoped to what the person may see) ---------- */
H.route('GET', '/api/search', { roles: ['landlord', 'property_manager', 'caretaker'], rate: [120, 60000] }, async (ctx) => {
  const { q } = clean(ctx.query, { q: { t: 's', req: true, min: 2, max: 60 } });
  const t = q.toLowerCase(); const has = (...f) => f.join(' ').toLowerCase().includes(t); const can = (p) => R.can(ctx.user, p); const s = ctx.scope; const out = {};
  const myProps = db.properties.byOwner(s.ownerId).filter((p) => p.status !== 'archived' && (s.all || s.props.has(p.id)));
  if (can('property.read')) out.properties = myProps.filter((p) => has(p.name, p.town, p.county, p.address)).slice(0, 8).map((p) => ({ id: p.id, title: p.name, sub: `${p.town || ''}, ${p.county || ''}`, link: '#/properties/' + p.id }));
  if (can('unit.read')) out.units = D.listScoped(db.units, ctx).filter((u) => !u.archived && has(u.name, u.type)).slice(0, 8).map((u) => ({ id: u.id, title: u.name, sub: `${u.type} - ${(db.properties.get(u.propertyId) || {}).name || ''}`, link: '#/properties/' + u.propertyId }));
  if (can('tenant.read') || can('tenant.read.basic')) out.tenants = D.listScoped(db.users, ctx).filter((u) => u.role === 'tenant' && has(u.name, u.phone, can('tenant.read') ? u.email : '')).slice(0, 8).map((u) => ({ id: u.id, title: u.name, sub: u.phone, link: '#/tenants/' + u.id }));
  if (can('lead.read')) out.leads = D.orgList(db.leads, ctx).filter((l) => has(l.name, l.phone, l.email)).slice(0, 8).map((l) => ({ id: l.id, title: l.name, sub: `${l.interest} - ${l.stage}`, link: '#/leads' }));
  if (can('sales.read')) out.sales = D.orgList(db.sales, ctx).filter((x) => has(x.title, x.town)).slice(0, 8).map((x) => ({ id: x.id, title: x.title, sub: `${x.town} - KES ${x.price.toLocaleString()}`, link: '#/sales' }));
  if (can('asset.read')) out.assets = D.listScoped(db.assets, ctx).filter((a) => has(a.name, a.category, a.serial)).slice(0, 8).map((a) => ({ id: a.id, title: a.name, sub: a.category.replace(/_/g, ' '), link: '#/assets' }));
  return { q, results: out };
});

/* ---------- CSV exports ---------- */
const csvCell = (v) => { let s = v === null || v === undefined ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const toCsv = (cols, rows) => '﻿' + [cols.map((c) => c[0]).join(','), ...rows.map((r) => cols.map((c) => csvCell(c[1](r))).join(','))].join('\r\n') + '\r\n';
const dt = (ts) => (ts ? U.dateOf(ts) : '');
const EXPORTS = {
  leads: { perm: 'lead.read', rows: (ctx) => D.orgList(db.leads, ctx), cols: [['Name', (l) => l.name], ['Phone', (l) => l.phone], ['Email', (l) => l.email], ['Interest', (l) => l.interest], ['Stage', (l) => l.stage], ['Source', (l) => l.source], ['Budget min', (l) => l.budgetMin], ['Budget max', (l) => l.budgetMax], ['Next follow-up', (l) => l.nextFollowUp], ['Created', (l) => dt(l.createdAt)]] },
  sales: { perm: 'sales.read', rows: (ctx) => D.orgList(db.sales, ctx), cols: [['Title', (s) => s.title], ['Type', (s) => s.kind], ['County', (s) => s.county], ['Town', (s) => s.town], ['Price', (s) => s.price], ['Status', (s) => s.status], ['Verified', (s) => (s.verified ? 'yes' : 'no')], ['Title type', (s) => s.titleType], ['Listed', (s) => dt(s.listedAt)]] },
  deals: { perm: 'lead.read', rows: (ctx) => D.orgList(db.deals, ctx), cols: [['Type', (d) => d.type], ['Client', (d) => d.clientName], ['Value', (d) => d.price], ['Commission %', (d) => d.commissionPct], ['Commission fixed', (d) => d.commissionFixed], ['Commission total', (d) => Math.round(((d.price * (d.commissionPct || 0)) / 100 + (d.commissionFixed || 0)) * 100) / 100], ['Status', (d) => d.status], ['Created', (d) => dt(d.createdAt)], ['Closed', (d) => dt(d.closedAt)]] },
  stays: { perm: 'stay.read', rows: (ctx) => D.listScoped(db.stays, ctx), cols: [['Guest', (s) => s.guestName], ['Phone', (s) => s.guestPhone], ['Unit', (s) => (db.units.get(s.unitId) || {}).name], ['Check-in', (s) => s.checkIn], ['Check-out', (s) => s.checkOut], ['Nights', (s) => s.nights], ['Total', (s) => s.total], ['Paid', (s) => s.paid], ['Status', (s) => s.status], ['Source', (s) => s.source]] },
  assets: { perm: 'asset.read', rows: (ctx) => D.listScoped(db.assets, ctx), cols: [['Asset', (a) => a.name], ['Category', (a) => a.category], ['Property', (a) => (db.properties.get(a.propertyId) || {}).name], ['Location', (a) => a.location], ['Status', (a) => a.status], ['Last service', (a) => a.lastService], ['Next service', (a) => a.nextService], ['Warranty until', (a) => a.warrantyUntil]] },
  compliance: { perm: 'compliance.read', rows: (ctx) => D.orgList(db.compliance, ctx), cols: [['Kind', (c) => c.kind], ['Title', (c) => c.title], ['Reference', (c) => c.refNo], ['Issuer', (c) => c.issuer], ['Issued', (c) => c.issued], ['Expires', (c) => c.expires], ['Property', (c) => (db.properties.get(c.propertyId) || {}).name || 'All']] },
};
H.route('GET', '/api/export/:what', { roles: ['landlord', 'property_manager', 'caretaker'], rate: [30, 3600000] }, async (ctx) => {
  const x = EXPORTS[ctx.params.what]; if (!x) throw E.notFound('Unknown export');
  if (!R.can(ctx.user, x.perm)) throw E.forbidden();
  const csv = Buffer.from(toCsv(x.cols, x.rows(ctx)));
  D.audit(ctx, 'export.' + ctx.params.what, 'export', ctx.params.what, {});
  ctx.send(200, csv, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="jasmyle-${ctx.params.what}-${U.todayStr()}.csv"`, 'Cache-Control': 'no-store' });
});

/* ---------- server metrics for National Administration ---------- */
H.route('GET', '/api/admin/metrics', { perm: 'platform.settings' }, async () => {
  const m = H.metrics(); const mem = process.memoryUsage(); const raw = S.raw();
  let dbBytes = 0, walBytes = 0; try { dbBytes = fs.statSync(cfg.paths.db).size; } catch { /* ignore */ } try { walBytes = fs.statSync(cfg.paths.db + '-wal').size; } catch { /* ignore */ }
  const tables = {}; for (const name of Object.keys(S.DEFS)) { try { tables[name] = S.db[name].count(); } catch { /* ignore */ } }
  let free = null; try { const st = fs.statfsSync(cfg.paths.data); free = Number(st.bavail) * Number(st.bsize); } catch { /* ignore */ }
  let integrity = null; try { integrity = Object.values(raw.prepare('PRAGMA quick_check').get())[0]; } catch { /* ignore */ }
  return { uptimeSec: Math.round(process.uptime()), node: process.version, pid: process.pid, memoryMb: { rss: Math.round(mem.rss / 1048576), heapUsed: Math.round(mem.heapUsed / 1048576) }, requests: m, db: { sizeMb: Math.round((dbBytes / 1048576) * 10) / 10, walMb: Math.round((walBytes / 1048576) * 10) / 10, integrity, tables }, diskFreeGb: free === null ? null : Math.round((free / 1073741824) * 10) / 10, jobs: S.meta.get('jobs:last', null), boots: S.meta.get('boot:count', 0), auditChain: S.audit.verify() };
});

module.exports = { toCsv };
