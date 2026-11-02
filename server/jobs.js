'use strict';
// Background work: monthly invoices, rent reminders, overdue alerts, payment reconciliation, automatic backups.
// Everything is idempotent, so it is safe if the laptop was off for days: the next run catches up.
const S = require('./store');
const { db } = S;
const U = require('./util');
const { log } = U;
const D = require('./domain');
const gw = require('./gateways');

function generateInvoices() {
  let n = 0;
  for (const l of db.leases.where('status', 'active')) {
    const owner = db.users.get(l.ownerId);
    if (!owner || owner.status !== 'active') continue;
    try { n += S.tx(() => D.generateForLease(l)); } catch (e) { log('error', 'invoice generation failed: ' + e.message, { lease: l.id }); }
  }
  return n;
}

function remindersAndOverdue() {
  const today = U.todayStr();
  let sent = 0;
  for (const i of db.invoices.where('status', 'open')) {
    const bal = D.r2(i.amount - i.paid);
    if (bal <= 0.004 || i.type === 'deposit' && i.dueDate > today) continue;
    const st = D.getSettings(i.ownerId) || D.defaultSettings(i.ownerId);
    const tenant = db.users.get(i.tenantId);
    if (!tenant || tenant.tenancy === 'former') continue;
    const unit = db.units.get(i.unitId);
    const days = U.daysBetween(today, i.dueDate);
    const flags = { ...(i.flags || {}) };
    let changed = false;
    if (days >= 0 && days <= st.reminderDays && !flags.pre) {
      const msg = `${i.desc} of ${D.fmtMoney(bal)} is due ${days === 0 ? 'today' : 'in ' + days + ' day(s)'} (${i.dueDate}).`;
      D.notify(tenant.id, 'Rent reminder', msg, 'reminder', '#/home');
      D.smsTo(i.ownerId, tenant.phone, `Reminder: ${msg} Pay via M-Pesa in the rent app.`);
      flags.pre = today; changed = true; sent++;
    }
    if (days < 0) {
      const last = flags.overdue;
      if (!last || U.daysBetween(last, today) >= (st.overdueRepeatDays || 7)) {
        const late = -days;
        D.notify(tenant.id, 'Rent overdue', `${i.desc}: ${D.fmtMoney(bal)} is ${late} day(s) overdue. Please pay now.`, 'overdue', '#/home');
        D.smsTo(i.ownerId, tenant.phone, `Your ${i.desc} of ${D.fmtMoney(bal)} is ${late} day(s) overdue. Please pay now.`);
        if (!last) { // first time: alert landlord and the managers of this property
          D.notifyOrg(i.ownerId, i.propertyId, 'Rent overdue', `${tenant.name} (${unit ? unit.name : ''}) owes ${D.fmtMoney(bal)} for ${i.desc}.`, 'overdue', '#/arrears');
          const owner = db.users.get(i.ownerId);
          if (owner) D.smsTo(i.ownerId, owner.phone, `Overdue: ${tenant.name} (${unit ? unit.name : ''}) owes ${D.fmtMoney(bal)}.`);
        }
        flags.overdue = today; changed = true; sent++;
      }
    }
    if (changed) db.invoices.update(i.id, { flags });
  }
  return sent;
}

async function reconcilePayments() {
  let n = 0;
  for (const p of db.payments.where('status', 'pending')) {
    const age = Date.now() - p.createdAt;
    try {
      if (p.simulated) { if (age > 3600e3) db.payments.update(p.id, { status: 'failed', failReason: 'Expired' }); continue; }
      if (p.method === 'mpesa' && p.checkoutRequestId) {
        if (age > 60e3 && age < 24 * 3600e3) {
          const st = D.getSettings(p.ownerId);
          const q = await gw.mpesaStkQuery(st.mpesa, p.checkoutRequestId);
          if (q.final) {
            if (q.code === 0) D.completePayment(p.id, { providerRef: 'CHK:' + p.checkoutRequestId });
            else db.payments.update(p.id, { status: 'failed', failReason: q.desc || 'Not approved' });
            n++;
          } else if (age > 15 * 60e3) { db.payments.update(p.id, { status: 'failed', failReason: 'Timed out - no response from the customer' }); n++; }
        }
      } else if (age > 2 * 3600e3) { db.payments.update(p.id, { status: 'failed', failReason: 'Expired - not completed' }); n++; }
    } catch (e) { log('warn', 'reconcile failed: ' + e.message, { payment: p.id }); }
  }
  return n;
}

function leaseExpiryNotices() {
  const today = U.todayStr();
  for (const l of db.leases.where('status', 'active')) {
    if (!l.endDate) continue;
    const left = U.daysBetween(today, l.endDate);
    if (left <= 30 && left >= 0 && !l.expiryNoticed) {
      const unit = db.units.get(l.unitId); const t = db.users.get(l.tenantId);
      D.notifyOrg(l.ownerId, l.propertyId, 'Lease ending soon', `${t ? t.name : 'Tenant'} (${unit ? unit.name : ''}) - lease ends ${l.endDate}.`, 'lease', '#/leases');
      db.leases.update(l.id, { expiryNoticed: true });
    }
  }
}

/* ---------- ecosystem reminders: licences/insurance, asset servicing, sale-lead follow-ups, guest arrivals ---------- */
function ecosystemReminders() {
  const today = U.todayStr(); let n = 0;
  for (const c of db.compliance.all()) {
    const left = U.daysBetween(today, c.expires); const tier = left < 0 ? 'expired' : left <= 7 ? 'week' : left <= 30 ? 'month' : null;
    if (!tier || c.noticed === tier) continue;
    const o = db.users.get(c.ownerId); if (!o || o.status !== 'active') continue;
    D.notifyOrg(c.ownerId, c.propertyId, tier === 'expired' ? 'Licence / insurance EXPIRED' : 'Licence / insurance expiring', `${c.title}${c.refNo ? ' (' + c.refNo + ')' : ''} ${left < 0 ? 'expired on ' : 'expires on '}${c.expires}.`, 'compliance', '#/compliance');
    db.compliance.update(c.id, { noticed: tier }); n++;
  }
  for (const a of db.assets.all()) {
    if (!a.nextService) continue;
    const left = U.daysBetween(today, a.nextService); const tier = left < 0 ? 'overdue' : left <= 14 ? 'soon' : null;
    if (!tier || a.noticed === a.nextService + tier) continue;
    D.notifyOrg(a.ownerId, a.propertyId, tier === 'overdue' ? 'Service overdue' : 'Service due soon', `${a.name} - service ${left < 0 ? 'was due ' : 'due '}${a.nextService}.`, 'asset', '#/assets', { caretakers: true });
    db.assets.update(a.id, { noticed: a.nextService + tier }); n++;
  }
  for (const l of db.leads.all()) {
    if (['won', 'lost'].includes(l.stage) || !l.nextFollowUp || l.nextFollowUp > today || l.followNoticed === l.nextFollowUp) continue;
    D.notifyOrg(l.ownerId, l.propertyId, 'Lead follow-up due', `Call ${l.name}${l.phone ? ' (' + l.phone + ')' : ''} - ${l.interest}.`, 'lead', '#/leads');
    db.leads.update(l.id, { followNoticed: l.nextFollowUp }); n++;
  }
  const tomorrow = U.addDays(today, 1);
  for (const s of db.stays.where('status', 'booked')) {
    if (s.checkIn !== tomorrow || s.reminded || !s.guestPhone) continue;
    const u = db.units.get(s.unitId) || {};
    D.smsTo(s.ownerId, s.guestPhone, `Hello ${String(s.guestName).split(' ')[0]}, we look forward to hosting you at ${u.name || 'our place'} tomorrow (${s.checkIn}).`);
    db.stays.update(s.id, { reminded: true }); n++;
  }
  return n;
}

/* ---------- data-protection retention: storage limitation (Data Protection Act, 2019, s.25(f)) ---------- */
function retention() {
  const now = Date.now(); const cut24 = now - 730 * 864e5; const cut6m = now - 183 * 864e5; let n = 0;
  for (const a of db.alerts.all()) if (!a.active && a.updatedAt < cut6m) { db.alerts.remove(a.id); n++; }
  for (const v of db.viewings.all()) if (v.name !== 'Erased' && v.createdAt < cut24 && v.status !== 'requested') { db.viewings.update(v.id, { name: 'Erased', phone: '', message: '' }); n++; }
  for (const l of db.leads.all()) if (l.name !== 'Erased' && (l.updatedAt || l.createdAt) < cut24 && !db.deals.where('leadId', l.id).length) { db.leads.update(l.id, { name: 'Erased', phone: '', email: '', notes: [], preferences: '' }); n++; }
  for (const r of db.service_requests.all()) if (r.name !== 'Erased' && r.createdAt < cut24) { db.service_requests.update(r.id, { name: 'Erased', phone: '', message: '' }); n++; }
  return n;
}

function dbMaintenance() {
  const last = S.meta.get('db:optimized', 0);
  if (Date.now() - last < 24 * 3600e3) return;
  try { S.raw().exec('PRAGMA optimize'); if (Date.now() - S.meta.get('db:analyzed', 0) > 7 * 86400e3) { S.raw().exec('ANALYZE'); S.meta.set('db:analyzed', Date.now()); } } catch (e) { log('warn', 'db maintenance: ' + e.message); }
  S.meta.set('db:optimized', Date.now());
}

function housekeeping() {
  const now = Date.now();
  for (const s of db.sessions.all()) if (s.expiresAt < now || now - s.lastSeen > s.idleMs) db.sessions.remove(s.id);
  for (const n of db.notifications.all()) if (n.read && now - n.createdAt > 90 * 86400e3) db.notifications.remove(n.id);
  const last = S.meta.get('backup:last', 0);
  if (now - last > 20 * 3600e3) { S.backup('auto'); S.meta.set('backup:last', now); log('info', 'Automatic backup created'); }
}

let running = false;
async function tick(reason) {
  if (running) return;
  running = true;
  const t0 = Date.now();
  try {
    const invoices = generateInvoices();
    const notices = remindersAndOverdue();
    leaseExpiryNotices();
    const eco = ecosystemReminders();
    if (Date.now() - S.meta.get('retention:last', 0) > 24 * 3600e3) { S.meta.set('retention:last', Date.now()); const r = retention(); if (r) log('info', 'Data retention cleanup', { records: r }); }
    const reconciled = await reconcilePayments();
    const PL = require('./platform'); const ET = require('./etims'); const RL = require('./rules');
    const feeInv = PL.generateInvoices(); const feeDun = PL.dunning();
    const al = await require('./routes/market').runAlerts();
    ET.enqueue(); const etSent = await ET.processQueue();
    if (Date.now() - S.meta.get('rules:lastCheck', 0) > 24 * 3600e3) { S.meta.set('rules:lastCheck', Date.now()); await RL.checkFeed(); try { await require('./routes/billing').probe(); } catch (e) { log('warn', 'probe failed: ' + e.message); } }
    housekeeping(); dbMaintenance();
    S.meta.set('jobs:last', { at: Date.now(), ms: Date.now() - t0, invoices, notices, reconciled, feeInv, feeDun, etSent, eco, reason });
    if (invoices || notices || reconciled) log('info', 'Background jobs', { invoices, notices, reconciled });
  } catch (e) { log('error', 'Background job error: ' + (e && e.stack || e)); } finally { running = false; }
}
let timer = null;
function start() {
  setTimeout(() => tick('startup'), 3000).unref();
  timer = setInterval(() => tick('timer'), 5 * 60 * 1000);
  timer.unref();
}
function stop() { if (timer) clearInterval(timer); }

module.exports = { start, stop, tick, generateInvoices, remindersAndOverdue, ecosystemReminders, retention };
