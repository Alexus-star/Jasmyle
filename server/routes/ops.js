'use strict';
// Maintenance, contractors, inspections, chat, notifications and encrypted file storage.
const fs = require('fs');
const path = require('path');
const S = require('../store');
const { db } = S;
const U = require('../util');
const { E, clean } = U;
const sec = require('../sec');
const cfg = require('../config');
const R = require('../roles');
const H = require('../http');
const D = require('../domain');

/* ======================= MAINTENANCE ======================= */
const M_CATS = ['Plumbing', 'Electrical', 'Roof / leaks', 'Doors & locks', 'Windows', 'Painting', 'Appliances', 'Security', 'Pests', 'Cleaning', 'Other'];
const OPEN = ['submitted', 'approved', 'assigned', 'in_progress'];

function visibleM(ctx, m) {
  const s = ctx.scope;
  if (s.kind === 'jobs') return !!s.contractorId && m.contractorId === s.contractorId && m.ownerId === s.ownerId;
  return R.inScope(s, m);
}
function getM(ctx, id) {
  const m = db.maintenance.get(id);
  if (!m || !visibleM(ctx, m)) throw E.notFound();
  return m;
}
function mView(m, ctx) {
  const unit = db.units.get(m.unitId); const prop = db.properties.get(m.propertyId); const t = db.users.get(m.tenantId); const c = m.contractorId ? db.contractors.get(m.contractorId) : null;
  const files = db.files.where('refId', m.id).filter((f) => f.refType === 'maintenance').map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size }));
  const out = { ...m, unitName: unit ? unit.name : '', propertyName: prop ? prop.name : '', tenantName: t ? t.name : '', contractorName: c ? c.name : '', files };
  if (ctx.user.role === 'caretaker') { delete out.estimate; delete out.cost; delete out.expenseId; delete out.overBudget; }
  if (ctx.user.role === 'tenant') { delete out.estimate; delete out.cost; delete out.expenseId; delete out.overBudget; }
  return out;
}
H.route('GET', '/api/maintenance', { perm: 'maintenance.read' }, async (ctx) => {
  let rows;
  if (ctx.scope.kind === 'jobs') rows = ctx.scope.contractorId ? db.maintenance.byOwner(ctx.scope.ownerId).filter((m) => visibleM(ctx, m)) : [];
  else rows = D.listScoped(db.maintenance, ctx);
  const q = ctx.query;
  if (q.status === 'open') rows = rows.filter((m) => OPEN.includes(m.status)); else if (q.status) rows = rows.filter((m) => m.status === q.status);
  if (q.propertyId) rows = rows.filter((m) => m.propertyId === q.propertyId);
  const prio = { urgent: 0, normal: 1, low: 2 };
  rows.sort((a, b) => (OPEN.includes(b.status) - OPEN.includes(a.status)) || (prio[a.priority] - prio[b.priority]) || b.createdAt - a.createdAt);
  return { categories: M_CATS, requests: rows.slice(0, 500).map((m) => mView(m, ctx)) };
});
H.route('GET', '/api/maintenance/:id', { perm: 'maintenance.read' }, async (ctx) => ({ request: mView(getM(ctx, ctx.params.id), ctx) }));

H.route('POST', '/api/maintenance', { perm: 'maintenance.report', rate: [20, 60000] }, async (ctx) => {
  const b = clean(ctx.body, { unitId: { t: 'id' }, title: { t: 's', req: true, min: 3, max: 120, label: 'Short title' }, description: { t: 's', max: 1500 }, category: { t: 'e', values: M_CATS, def: 'Other' }, priority: { t: 'e', values: ['low', 'normal', 'urgent'], def: 'normal' } });
  let unit; let tenantId;
  if (ctx.user.role === 'tenant') {
    const lease = require('./money').leaseForTenant(ctx.user.id, ctx.user.ownerId);
    if (!lease || lease.status !== 'active') throw E.conflict('You need an active tenancy to report a problem.');
    unit = db.units.get(lease.unitId); tenantId = ctx.user.id;
  } else {
    if (!b.unitId) throw E.bad('Choose the unit with the problem');
    unit = D.getScoped(db.units, b.unitId, ctx); tenantId = unit.tenantId || null;
  }
  const m = db.maintenance.insert({
    ownerId: unit.ownerId, propertyId: unit.propertyId, unitId: unit.id, tenantId, reportedBy: ctx.user.id, reporterRole: ctx.user.role, title: b.title, description: b.description || '', category: b.category, priority: b.priority,
    status: 'submitted', estimate: null, cost: null, contractorId: null, notes: [{ by: ctx.user.name, role: ctx.user.role, at: Date.now(), text: 'Request submitted' }],
  });
  D.notifyOrg(m.ownerId, m.propertyId, (m.priority === 'urgent' ? 'URGENT: ' : '') + 'New maintenance request', `${unit.name}: ${m.title}`, 'maintenance', '#/maintenance', { caretakers: true });
  D.audit(ctx, 'maintenance.created', 'maintenance', m.id, { unit: unit.name, priority: m.priority });
  return { request: mView(m, ctx) };
});

const addNote = (m, ctx, text) => [...(m.notes || []), { by: ctx.user.name, role: ctx.user.role, at: Date.now(), text }].slice(-60);

H.route('POST', '/api/maintenance/:id/approve', { perm: 'maintenance.approve' }, async (ctx) => {
  const b = clean(ctx.body, { estimate: { t: 'n', req: true, max: 1e9, label: 'Estimated cost' }, note: { t: 's', max: 300 } });
  const m = getM(ctx, ctx.params.id);
  if (m.status !== 'submitted') throw E.conflict('This request has already been handled.');
  if (ctx.user.role === 'property_manager' && b.estimate > (ctx.user.approvalLimit ?? 0)) {
    db.maintenance.update(m.id, { escalated: true, estimate: b.estimate, notes: addNote(m, ctx, `Needs landlord approval (estimate ${D.fmtMoney(b.estimate)} is above manager limit)`) });
    D.notify(ctx.scope.ownerId, 'Maintenance needs your approval', `${m.title} - estimate ${D.fmtMoney(b.estimate)} is above the manager's limit of ${D.fmtMoney(ctx.user.approvalLimit ?? 0)}.`, 'maintenance', '#/maintenance');
    D.audit(ctx, 'maintenance.escalated', 'maintenance', m.id, { estimate: b.estimate });
    return { ok: true, escalated: true, message: 'This is above your approval limit, so it has been sent to the landlord for approval.' };
  }
  const up = db.maintenance.update(m.id, { status: 'approved', estimate: b.estimate, escalated: false, approvedBy: ctx.user.id, approvedAt: Date.now(), notes: addNote(m, ctx, 'Approved' + (b.note ? ': ' + b.note : '')) });
  if (m.tenantId) D.notify(m.tenantId, 'Repair approved', `"${m.title}" has been approved and will be scheduled.`, 'maintenance', '#/maintenance');
  D.audit(ctx, 'maintenance.approved', 'maintenance', m.id, { estimate: b.estimate });
  return { request: mView(up, ctx) };
});
H.route('POST', '/api/maintenance/:id/reject', { perm: 'maintenance.approve' }, async (ctx) => {
  const b = clean(ctx.body, { reason: { t: 's', req: true, min: 3, max: 300 } });
  const m = getM(ctx, ctx.params.id);
  if (m.status !== 'submitted') throw E.conflict('This request has already been handled.');
  const up = db.maintenance.update(m.id, { status: 'rejected', notes: addNote(m, ctx, 'Declined: ' + b.reason) });
  if (m.tenantId) D.notify(m.tenantId, 'Request declined', `"${m.title}": ${b.reason}`, 'maintenance', '#/maintenance');
  D.audit(ctx, 'maintenance.rejected', 'maintenance', m.id, { reason: b.reason });
  return { request: mView(up, ctx) };
});
H.route('POST', '/api/maintenance/:id/assign', { perm: 'maintenance.assign' }, async (ctx) => {
  const b = clean(ctx.body, { contractorId: { t: 'id', req: true }, scheduledDate: { t: 'd' }, note: { t: 's', max: 300 } });
  const m = getM(ctx, ctx.params.id);
  if (!['approved', 'assigned'].includes(m.status)) throw E.conflict('Approve the request before assigning a contractor.');
  const c = db.contractors.get(b.contractorId);
  if (!c || c.ownerId !== m.ownerId || c.active === false) throw E.bad('Choose a contractor from your list');
  const up = db.maintenance.update(m.id, { status: 'assigned', contractorId: c.id, scheduledDate: b.scheduledDate || null, assignedAt: Date.now(), notes: addNote(m, ctx, `Assigned to ${c.name}` + (b.scheduledDate ? ` for ${b.scheduledDate}` : '') + (b.note ? ': ' + b.note : '')) });
  for (const u of db.users.byOwner(m.ownerId).filter((x) => x.role === 'contractor' && x.contractorId === c.id)) D.notify(u.id, 'New job assigned', `${m.title}`, 'maintenance', '#/maintenance');
  if (m.tenantId) D.notify(m.tenantId, 'Repair scheduled', `${c.name} will handle "${m.title}"${b.scheduledDate ? ' on ' + b.scheduledDate : ''}.`, 'maintenance', '#/maintenance');
  D.audit(ctx, 'maintenance.assigned', 'maintenance', m.id, { contractor: c.name });
  return { request: mView(up, ctx) };
});
H.route('POST', '/api/maintenance/:id/status', { perm: 'maintenance.update' }, async (ctx) => {
  const b = clean(ctx.body, { status: { t: 'e', values: ['in_progress', 'completed'], req: true }, cost: { t: 'n', max: 1e9 }, note: { t: 's', max: 300 } });
  const m = getM(ctx, ctx.params.id);
  const allowed = { in_progress: ['assigned', 'approved'], completed: ['in_progress', 'assigned', 'approved'] };
  if (!allowed[b.status].includes(m.status)) throw E.conflict('That status change is not possible right now.');
  const canCost = ['landlord', 'property_manager', 'contractor'].includes(ctx.user.role);
  if (!canCost) delete b.cost; // caretakers never record money; a manager adds the cost afterwards
  if (b.status === 'completed' && canCost && b.cost === undefined) throw E.bad('Enter the final cost (enter 0 if there was no charge)');
  const out = S.tx(() => {
    const patch = { status: b.status, notes: addNote(m, ctx, (b.status === 'completed' ? 'Completed' : 'Work started') + (b.note ? ': ' + b.note : '')) };
    if (b.status === 'in_progress') patch.startedAt = Date.now();
    if (b.status === 'completed') {
      patch.completedAt = Date.now(); patch.cost = b.cost === undefined ? null : b.cost; patch.costPending = b.cost === undefined;
      patch.overBudget = !!(m.estimate && b.cost > m.estimate * 1.1);
      if (b.cost > 0) {
        const c = m.contractorId ? db.contractors.get(m.contractorId) : null;
        const unit = db.units.get(m.unitId);
        const e = db.expenses.insert({ ownerId: m.ownerId, propertyId: m.propertyId, category: 'Repairs & maintenance', amount: b.cost, date: U.todayStr(), description: `${m.title} (${unit ? unit.name : ''})`, vendor: c ? c.name : '', maintenanceId: m.id, createdBy: ctx.user.id, source: 'maintenance' });
        patch.expenseId = e.id;
      }
      if (patch.overBudget) D.notifyOrg(m.ownerId, m.propertyId, 'Repair cost above estimate', `${m.title}: estimate ${D.fmtMoney(m.estimate)}, final ${D.fmtMoney(b.cost)}. Please review.`, 'maintenance', '#/maintenance');
    }
    const up = db.maintenance.update(m.id, patch);
    if (m.tenantId) D.notify(m.tenantId, b.status === 'completed' ? 'Repair completed' : 'Work has started', `"${m.title}"`, 'maintenance', '#/maintenance');
    if (b.status === 'completed') D.notifyOrg(m.ownerId, m.propertyId, 'Repair completed', `${m.title}${b.cost ? ' - ' + D.fmtMoney(b.cost) : ''}`, 'maintenance', '#/maintenance');
    D.audit(ctx, 'maintenance.' + b.status, 'maintenance', m.id, { cost: b.cost });
    return up;
  });
  return { request: mView(out, ctx) };
});
H.route('POST', '/api/maintenance/:id/cost', { perm: 'expense.write' }, async (ctx) => {
  const b = clean(ctx.body, { cost: { t: 'n', req: true, max: 1e9, label: 'Final cost' } });
  const m = getM(ctx, ctx.params.id);
  if (m.status !== 'completed' || !m.costPending) throw E.conflict('The cost for this job is already recorded.');
  const up = S.tx(() => {
    const patch = { cost: b.cost, costPending: false, overBudget: !!(m.estimate && b.cost > m.estimate * 1.1), notes: addNote(m, ctx, `Final cost recorded: ${D.fmtMoney(b.cost)}`) };
    if (b.cost > 0) {
      const c = m.contractorId ? db.contractors.get(m.contractorId) : null; const unit = db.units.get(m.unitId);
      patch.expenseId = db.expenses.insert({ ownerId: m.ownerId, propertyId: m.propertyId, category: 'Repairs & maintenance', amount: b.cost, date: U.todayStr(), description: `${m.title} (${unit ? unit.name : ''})`, vendor: c ? c.name : '', maintenanceId: m.id, createdBy: ctx.user.id, source: 'maintenance' }).id;
    }
    D.audit(ctx, 'maintenance.cost_recorded', 'maintenance', m.id, { cost: b.cost });
    return db.maintenance.update(m.id, patch);
  });
  return { request: mView(up, ctx) };
});
H.route('POST', '/api/maintenance/:id/note', { perm: 'maintenance.read', rate: [30, 60000] }, async (ctx) => {
  const b = clean(ctx.body, { text: { t: 's', req: true, min: 1, max: 500 } });
  const m = getM(ctx, ctx.params.id);
  const up = db.maintenance.update(m.id, { notes: addNote(m, ctx, b.text) });
  return { request: mView(up, ctx) };
});
H.route('POST', '/api/maintenance/:id/cancel', { perm: 'maintenance.report' }, async (ctx) => {
  const b = clean(ctx.body, { reason: { t: 's', max: 200 } });
  const m = getM(ctx, ctx.params.id);
  if (!OPEN.includes(m.status)) throw E.conflict('This request is already closed.');
  const isReporter = m.reportedBy === ctx.user.id;
  if (ctx.user.role === 'tenant' && (!isReporter || m.status !== 'submitted')) throw E.forbidden('You can only cancel your own request before it is approved.');
  if (!['tenant'].includes(ctx.user.role) && !R.can(ctx.user, 'maintenance.approve') && !isReporter) throw E.forbidden();
  const up = db.maintenance.update(m.id, { status: 'cancelled', notes: addNote(m, ctx, 'Cancelled' + (b.reason ? ': ' + b.reason : '')) });
  D.audit(ctx, 'maintenance.cancelled', 'maintenance', m.id);
  return { request: mView(up, ctx) };
});
H.route('POST', '/api/maintenance/:id/rate', { perm: 'maintenance.rate' }, async (ctx) => {
  const b = clean(ctx.body, { rating: { t: 'n', int: true, min: 1, max: 5, req: true }, comment: { t: 's', max: 300 } });
  const m = getM(ctx, ctx.params.id);
  if (m.status !== 'completed') throw E.conflict('You can rate a job after it is completed.');
  const up = db.maintenance.update(m.id, { rating: b.rating, ratingComment: b.comment || '', ratedBy: ctx.user.id });
  D.audit(ctx, 'maintenance.rated', 'maintenance', m.id, { rating: b.rating });
  return { request: mView(up, ctx) };
});

/* ======================= CONTRACTORS ======================= */
function contractorStats(c) {
  const jobs = db.maintenance.byOwner(c.ownerId).filter((m) => m.contractorId === c.id);
  const done = jobs.filter((m) => m.status === 'completed');
  const rated = done.filter((m) => m.rating);
  const days = done.filter((m) => m.assignedAt && m.completedAt).map((m) => (m.completedAt - m.assignedAt) / 86400000);
  const withEst = done.filter((m) => m.estimate && m.cost !== null);
  return {
    jobs: jobs.length, active: jobs.filter((m) => ['assigned', 'in_progress'].includes(m.status)).length, completed: done.length,
    avgRating: rated.length ? Math.round((rated.reduce((a, m) => a + m.rating, 0) / rated.length) * 10) / 10 : null, ratings: rated.length,
    avgDays: days.length ? Math.round((days.reduce((a, x) => a + x, 0) / days.length) * 10) / 10 : null,
    totalCost: D.r2(done.reduce((a, m) => a + (m.cost || 0), 0)),
    overBudgetJobs: done.filter((m) => m.overBudget).length,
    onBudgetPct: withEst.length ? Math.round((withEst.filter((m) => !m.overBudget).length / withEst.length) * 100) : null,
  };
}
const CT_FIELDS = { name: { t: 's', req: true, max: 100, min: 2 }, trade: { t: 's', max: 60 }, phone: { t: 'phone' }, email: { t: 'email' }, notes: { t: 's', max: 300 }, active: { t: 'b', def: true } };
H.route('GET', '/api/contractors', { perm: 'contractor.read' }, async (ctx) => ({
  contractors: db.contractors.byOwner(ctx.scope.ownerId).map((c) => ({ ...c, stats: R.can(ctx.user, 'report.contractors') ? contractorStats(c) : undefined })).sort((a, b) => a.name.localeCompare(b.name)),
}));
H.route('POST', '/api/contractors', { perm: 'contractor.write' }, async (ctx) => {
  const b = clean(ctx.body, CT_FIELDS);
  const c = db.contractors.insert({ ownerId: ctx.scope.ownerId, ...b });
  D.audit(ctx, 'contractor.created', 'contractor', c.id, { name: c.name });
  return { contractor: c };
});
H.route('PUT', '/api/contractors/:id', { perm: 'contractor.write' }, async (ctx) => {
  const c = db.contractors.get(ctx.params.id);
  if (!c || c.ownerId !== ctx.scope.ownerId) throw E.notFound();
  const b = clean(ctx.body, { ...CT_FIELDS, version: { t: 'n', req: true, int: true } });
  const { version, ...patch } = b;
  return { contractor: db.contractors.update(c.id, patch, version) };
});

/* ======================= INSPECTIONS ======================= */
const CHECKLISTS = {
  routine: ['Gate, fence and security lights', 'Compound cleanliness and drainage', 'Water supply and pressure', 'Electricity meters and wiring (visible)', 'Roof and ceiling (no leaks or stains)', 'Walls and paint condition', 'Doors, locks and keys', 'Windows and grills', 'Kitchen: sink, taps and cabinets', 'Bathroom: toilet, shower, no leaks', 'Floors and tiles', 'Fire safety / extinguishers', 'Garbage area', 'Signs of pests'],
  move_in: ['Walls and paint', 'Floors and tiles', 'Doors and locks (all keys handed over)', 'Windows and grills', 'Electrical sockets and switches', 'Light fittings', 'Kitchen sink and taps', 'Toilet and shower', 'Water heater', 'Meter readings recorded', 'Ceiling condition'],
  move_out: ['Walls and paint (damage beyond wear)', 'Floors and tiles', 'Doors and locks (all keys returned)', 'Windows and grills', 'Electrical sockets and switches', 'Kitchen sink and taps', 'Toilet and shower', 'Cleanliness', 'Meter readings recorded', 'Missing or damaged fittings'],
};
H.route('GET', '/api/inspections/templates', { perm: 'inspection.read' }, async () => ({ templates: CHECKLISTS }));
H.route('GET', '/api/inspections', { perm: 'inspection.read' }, async (ctx) => {
  let rows = D.listScoped(db.inspections, ctx);
  if (ctx.query.propertyId) rows = rows.filter((i) => i.propertyId === ctx.query.propertyId);
  const props = new Map(db.properties.byOwner(ctx.scope.ownerId).map((p) => [p.id, p.name]));
  const units = new Map(db.units.byOwner(ctx.scope.ownerId).map((p) => [p.id, p.name]));
  return { inspections: rows.sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt).slice(0, 300).map((i) => ({ ...i, propertyName: props.get(i.propertyId) || '', unitName: units.get(i.unitId) || '' })) };
});
H.route('GET', '/api/inspections/:id', { perm: 'inspection.read' }, async (ctx) => {
  const i = D.getScoped(db.inspections, ctx.params.id, ctx);
  const files = db.files.where('refId', i.id).filter((f) => f.refType === 'inspection').map((f) => ({ id: f.id, name: f.name, mime: f.mime }));
  return { inspection: { ...i, propertyName: (db.properties.get(i.propertyId) || {}).name || '', unitName: (db.units.get(i.unitId) || {}).name || '', files } };
});
H.route('POST', '/api/inspections', { perm: 'inspection.write', rate: [30, 60000] }, async (ctx) => {
  const b = clean(ctx.body, { propertyId: { t: 'id', req: true }, unitId: { t: 'id' }, type: { t: 'e', values: ['routine', 'move_in', 'move_out'], req: true }, date: { t: 'd', def: U.todayStr() }, notes: { t: 's', max: 1000 }, createJobs: { t: 'b' } });
  const items = Array.isArray(ctx.body.items) ? ctx.body.items.slice(0, 60).map((x) => ({ label: String(x.label || '').slice(0, 120), result: ['pass', 'fail', 'na'].includes(x.result) ? x.result : 'na', note: String(x.note || '').slice(0, 300) })).filter((x) => x.label) : [];
  if (!items.length) throw E.bad('The checklist is empty');
  const p = D.getProperty(b.propertyId, ctx);
  let unit = null;
  if (b.unitId) { unit = D.getScoped(db.units, b.unitId, ctx); if (unit.propertyId !== p.id) throw E.bad('That unit is not in this property'); }
  const pass = items.filter((x) => x.result === 'pass').length; const fail = items.filter((x) => x.result === 'fail').length;
  const insp = S.tx(() => {
    const i = db.inspections.insert({ ownerId: p.ownerId, propertyId: p.id, unitId: unit ? unit.id : null, type: b.type, date: b.date, items, notes: b.notes || '', inspectorId: ctx.user.id, inspectorName: ctx.user.name, passed: pass, failed: fail, score: pass + fail ? Math.round((pass / (pass + fail)) * 100) : null, jobsCreated: 0 });
    let jobs = 0;
    if (b.createJobs && R.can(ctx.user, 'maintenance.report') && unit) {
      for (const f of items.filter((x) => x.result === 'fail')) {
        db.maintenance.insert({ ownerId: p.ownerId, propertyId: p.id, unitId: unit.id, tenantId: unit.tenantId || null, reportedBy: ctx.user.id, reporterRole: ctx.user.role, title: f.label.slice(0, 120), description: (f.note || '') + ' (found during inspection)', category: 'Other', priority: 'normal', status: 'submitted', estimate: null, cost: null, contractorId: null, inspectionId: i.id, notes: [{ by: ctx.user.name, role: ctx.user.role, at: Date.now(), text: 'Created from inspection' }] });
        jobs++;
      }
      if (jobs) { db.inspections.update(i.id, { jobsCreated: jobs }); D.notifyOrg(p.ownerId, p.id, 'Repairs found in inspection', `${jobs} problem(s) found in ${unit.name}`, 'maintenance', '#/maintenance'); }
    }
    D.audit(ctx, 'inspection.created', 'inspection', i.id, { property: p.name, failed: fail, jobs });
    return db.inspections.get(i.id);
  });
  return { inspection: insp };
});

/* ======================= CHAT ======================= */
function tenantInScopeForChat(ctx, tenantId) {
  if (ctx.user.role === 'tenant') { if (tenantId !== ctx.user.id) throw E.notFound(); return ctx.user; }
  const t = D.getScoped(db.users, tenantId, ctx);
  if (t.role !== 'tenant') throw E.notFound();
  return t;
}
H.route('GET', '/api/messages/threads', { perm: 'chat.use' }, async (ctx) => {
  const me = ctx.user.id;
  if (ctx.user.role === 'tenant') {
    const msgs = db.messages.byOwner(ctx.user.ownerId).filter((m) => m.tenantId === me);
    const last = msgs[msgs.length - 1];
    return { threads: [{ tenantId: me, name: 'Your landlord / property manager', last: last ? last.text : '', lastAt: last ? last.createdAt : 0, unread: msgs.filter((m) => m.fromId !== me && !(m.readBy || []).includes(me)).length }] };
  }
  const tenants = D.listScoped(db.users, ctx).filter((u) => u.role === 'tenant' && u.tenancy !== 'former');
  const byT = new Map();
  for (const m of D.listScoped(db.messages, ctx)) { const a = byT.get(m.tenantId) || []; a.push(m); byT.set(m.tenantId, a); }
  const units = new Map(db.units.byOwner(ctx.scope.ownerId).map((u) => [u.id, u.name]));
  const threads = tenants.map((t) => {
    const ms = byT.get(t.id) || []; const last = ms[ms.length - 1];
    return { tenantId: t.id, name: t.name, unitName: units.get(t.unitId) || '', last: last ? last.text : '', lastAt: last ? last.createdAt : 0, unread: ms.filter((m) => m.fromId !== me && !(m.readBy || []).includes(me)).length };
  });
  return { threads: threads.sort((a, b) => b.lastAt - a.lastAt || a.name.localeCompare(b.name)) };
});
H.route('GET', '/api/messages/thread/:tenantId', { perm: 'chat.use' }, async (ctx) => {
  const t = tenantInScopeForChat(ctx, ctx.params.tenantId);
  const me = ctx.user.id;
  const msgs = db.messages.byOwner(t.ownerId).filter((m) => m.tenantId === t.id).sort((a, b) => a.createdAt - b.createdAt).slice(-200);
  for (const m of msgs) if (m.fromId !== me && !(m.readBy || []).includes(me)) db.messages.update(m.id, (c) => { c.readBy = [...(c.readBy || []), me]; return c; });
  return { tenant: { id: t.id, name: t.name }, messages: msgs.map((m) => ({ id: m.id, fromId: m.fromId, fromName: m.fromName, fromRole: m.fromRole, text: m.text, at: m.createdAt, mine: m.fromId === me })) };
});
H.route('POST', '/api/messages', { perm: 'chat.use', rate: [40, 60000] }, async (ctx) => {
  const b = clean(ctx.body, { tenantId: { t: 'id' }, text: { t: 's', req: true, min: 1, max: 1000 } });
  const t = tenantInScopeForChat(ctx, ctx.user.role === 'tenant' ? ctx.user.id : b.tenantId);
  if (!t.propertyId && ctx.user.role !== 'tenant') throw E.conflict('This tenant has no property yet.');
  const m = db.messages.insert({ ownerId: t.ownerId, propertyId: t.propertyId || null, tenantId: t.id, fromId: ctx.user.id, fromName: ctx.user.name, fromRole: ctx.user.role, text: b.text, readBy: [ctx.user.id] });
  if (ctx.user.role === 'tenant') D.notifyOrg(t.ownerId, t.propertyId, 'Message from ' + t.name, b.text.slice(0, 120), 'chat', '#/chat/' + t.id, { caretakers: true });
  else D.notify(t.id, 'Message from ' + ctx.user.name, b.text.slice(0, 120), 'chat', '#/chat');
  return { message: { id: m.id, text: m.text, at: m.createdAt, mine: true, fromName: ctx.user.name, fromRole: ctx.user.role } };
});

/* ======================= NOTIFICATIONS ======================= */
H.route('GET', '/api/notifications', { skipGate: false }, async (ctx) => {
  const rows = db.notifications.where('userId', ctx.user.id).sort((a, b) => b.createdAt - a.createdAt);
  return { unread: rows.filter((n) => !n.read).length, notifications: rows.slice(0, 60).map((n) => ({ id: n.id, title: n.title, body: n.body, kind: n.kind, link: n.link, read: n.read, at: n.createdAt })) };
});
H.route('POST', '/api/notifications/read', {}, async (ctx) => {
  const b = clean(ctx.body, { ids: { t: 'ids', max: 100 }, all: { t: 'b' } });
  for (const n of db.notifications.where('userId', ctx.user.id)) if (!n.read && (b.all || (b.ids || []).includes(n.id))) db.notifications.update(n.id, { read: true });
  return { ok: true };
});

/* ======================= FILES (encrypted at rest) ======================= */
function sniff(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 4).toString() === 'GIF8') return 'image/gif';
  if (buf.subarray(0, 4).toString() === '%PDF') return 'application/pdf';
  if (buf.subarray(4, 8).toString() === 'ftyp') return buf.subarray(8, 10).toString() === 'qt' ? 'video/quicktime' : 'video/mp4';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
  return null;
}
const ALLOWED = { sale: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], lease: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], maintenance: ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/quicktime', 'video/webm', 'application/pdf'], inspection: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime', 'video/webm'], listing: ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm', 'video/quicktime'] };
const fpath = (id) => path.join(cfg.paths.files, id + '.enc');

/** Returns the parent record (lease / maintenance / inspection) if the caller may use files attached to it. */
function fileParent(ctx, refType, refId, write) {
  if (!ALLOWED[refType]) throw E.bad('Unknown file type');
  if (refType === 'sale') {
    if (!R.can(ctx.user, write ? 'sales.write' : 'sales.read')) throw E.forbidden();
    return D.orgGet(db.sales, refId, ctx);
  }
  if (refType === 'listing') {
    if (!R.can(ctx.user, write ? 'unit.write' : 'unit.read')) throw E.forbidden();
    return D.getScoped(db.units, refId, ctx);
  }
  if (refType === 'lease') {
    if (!R.can(ctx.user, 'lease.document')) throw E.forbidden();
    if (write && ctx.user.role === 'tenant') throw E.forbidden();
    return D.getScoped(db.leases, refId, ctx);
  }
  if (refType === 'maintenance') {
    if (!R.can(ctx.user, write ? (ctx.user.role === 'contractor' ? 'maintenance.update' : 'maintenance.report') : 'maintenance.read')) throw E.forbidden();
    return getM(ctx, refId);
  }
  if (!R.can(ctx.user, write ? 'inspection.write' : 'inspection.read')) throw E.forbidden();
  return D.getScoped(db.inspections, refId, ctx);
}
H.route('POST', '/api/files', { raw: true, rate: [40, 60000] }, async (ctx) => {
  const q = clean(ctx.query, { refType: { t: 'e', values: Object.keys(ALLOWED), req: true }, refId: { t: 'id', req: true }, name: { t: 's', max: 120, def: 'file' }, tag: { t: 'e', values: ['photo', 'floorplan'], def: 'photo' } });
  const parent = fileParent(ctx, q.refType, q.refId, true);
  const buf = ctx.rawBody;
  if (!buf || !buf.length) throw E.bad('No file received');
  const mime = sniff(buf);
  if (!mime || !ALLOWED[q.refType].includes(mime)) throw E.bad('That file type is not allowed. Use a photo (JPG/PNG), a short video (MP4) or a PDF where applicable.');
  const maxBytes = mime.startsWith('video/') ? cfg.limits.video : mime === 'application/pdf' ? cfg.limits.doc : cfg.limits.image;
  if (buf.length > maxBytes) throw E.bad(`That file is too large (maximum ${Math.round(maxBytes / 1048576)} MB)`);
  const existing = db.files.where('refId', parent.id).filter((f) => f.refType === q.refType);
  if (q.refType === 'listing') {
    const vids = existing.filter((f) => f.mime.startsWith('video/')).length;
    if (mime.startsWith('video/') && vids >= 3) throw E.conflict('A listing can have up to 3 videos.');
    if (!mime.startsWith('video/') && existing.length - vids >= 20) throw E.conflict('A listing can have up to 20 photos.');
  } else if (q.refType === 'sale') {
    if (existing.length >= 20) throw E.conflict('A sale listing can have up to 20 photos / documents.');
  } else if (existing.length >= (q.refType === 'lease' ? 10 : 8)) throw E.conflict('This record already has the maximum number of files.');
  const safe = q.name.replace(/[^\w.\- ()]/g, '_').slice(0, 100) || 'file';
  const id = U.newId('fil');
  fs.mkdirSync(cfg.paths.files, { recursive: true });
  const tmp = fpath(id) + '.tmp';
  fs.writeFileSync(tmp, sec.encBuffer(buf, id));
  fs.renameSync(tmp, fpath(id));
  const rec = db.files.insert({ id, ownerId: parent.ownerId, propertyId: parent.propertyId || null, tenantId: parent.tenantId || null, refType: q.refType, refId: parent.id, name: safe, mime, size: buf.length, uploadedBy: ctx.user.id, tag: q.tag });
  D.audit(ctx, 'file.uploaded', q.refType, parent.id, { name: safe, size: buf.length });
  return { file: { id: rec.id, name: rec.name, mime: rec.mime, size: rec.size } };
});
H.route('GET', '/api/files', {}, async (ctx) => {
  const q = clean(ctx.query, { refType: { t: 'e', values: Object.keys(ALLOWED), req: true }, refId: { t: 'id', req: true } });
  const parent = fileParent(ctx, q.refType, q.refId, false);
  return { files: db.files.where('refId', parent.id).filter((f) => f.refType === q.refType).sort((a, b) => a.createdAt - b.createdAt).map((f) => ({ id: f.id, name: f.name, mime: f.mime, size: f.size, at: f.createdAt, tag: f.tag || 'photo' })) };
});
H.route('GET', '/api/files/:id', {}, async (ctx) => {
  const f = db.files.get(ctx.params.id);
  if (!f) throw E.notFound();
  fileParent(ctx, f.refType, f.refId, false); // throws unless the caller may see the parent record
  if (f.refType === 'lease') D.audit(ctx, 'file.lease_opened', 'lease', f.refId, { name: f.name });
  return sendFile(ctx, f, { 'Cache-Control': 'private, no-store' });
});
/** Decrypts and sends a stored file, with HTTP Range support (video seeking). */
function sendFile(ctx, f, extra) {
  let buf;
  try { buf = sec.decBuffer(fs.readFileSync(fpath(f.id)), f.id); } catch { throw E.notFound('This file could not be read'); }
  const total = buf.length;
  const h = { 'Content-Type': f.mime, 'Content-Disposition': `${ctx.query.download ? 'attachment' : 'inline'}; filename="${f.name.replace(/"/g, '')}"`, 'Accept-Ranges': 'bytes', ...extra };
  const range = /^bytes=(\d*)-(\d*)$/.exec(ctx.req.headers.range || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : total - Number(range[2]); let end = range[1] && range[2] ? Number(range[2]) : total - 1;
    start = Math.max(0, start); end = Math.min(end, total - 1);
    if (start > end) return ctx.send(416, Buffer.alloc(0), { 'Content-Range': `bytes */${total}` });
    return ctx.send(206, buf.subarray(start, end + 1), { ...h, 'Content-Range': `bytes ${start}-${end}/${total}` });
  }
  ctx.send(200, buf, h);
}
H.route('DELETE', '/api/files/:id', {}, async (ctx) => {
  const f = db.files.get(ctx.params.id);
  if (!f) throw E.notFound();
  fileParent(ctx, f.refType, f.refId, true);
  if (f.uploadedBy !== ctx.user.id && ctx.user.role !== 'landlord') throw E.forbidden('Only the person who uploaded this file or the landlord can remove it.');
  db.files.remove(f.id);
  try { fs.unlinkSync(fpath(f.id)); } catch { /* ignore */ }
  D.audit(ctx, 'file.deleted', f.refType, f.refId, { name: f.name });
  return { ok: true };
});

module.exports = { sendFile, mView, visibleM, contractorStats, M_CATS, CHECKLISTS };
