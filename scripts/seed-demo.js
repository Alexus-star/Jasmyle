'use strict';
// Fills an EMPTY system with realistic sample data so you can try every screen or demonstrate to a client.
//   node scripts/seed-demo.js
// Refuses to run if landlords already exist. Passwords are random and printed once.
const S = require('../server/store');
const sec = require('../server/sec');
const U = require('../server/util');
const D = require('../server/domain');
const { db } = S;

const pw = () => sec.genPassword();
async function mk(fields, password) {
  const r = await D.makeUser(fields, { password, mustChange: false });
  return { ...r.user, plain: password };
}

async function seed({ quiet = false } = {}) {
  if (db.users.where('role', 'landlord').length) throw new Error('This system already has landlords. Demo data is only added to an empty system.');
  const log = (...a) => { if (!quiet) console.log(...a); };
  const today = U.todayStr(); const cur = U.monthOf(today);
  const creds = [];
  const add = (label, u) => { creds.push({ label, name: u.name, login: u.email || u.phone, password: u.plain }); return u; };

  const grace = add('Landlord', await mk({ role: 'landlord', name: 'Grace Wanjiku', company: 'Wanjiku Properties', email: 'grace@example.com', phone: '254711000001', county: 'Nairobi', town: 'Kilimani', status: 'active' }, pw()));
  const peter = add('Landlord (another owner)', await mk({ role: 'landlord', name: 'Peter Otieno', company: 'Otieno Estates', email: 'peter@example.com', phone: '254711000002', county: 'Mombasa', town: 'Nyali', status: 'active' }, pw()));
  D.ensureSettings(grace.id); D.ensureSettings(peter.id);
  db.settings.update(D.ensureSettings(grace.id).id, (s) => { s.orgName = 'Wanjiku Properties'; s.bank = { enabled: true, bankName: 'Equity Bank', accountName: 'Wanjiku Properties Ltd', accountNo: '0123456789012', branch: 'Kilimani', instructions: 'Use your unit number as the reference' }; return s; });

  const mkProp = (owner, name, county, town, address, verified, amenities) => {
    const id = U.newId('prp');
    return db.properties.insert({ id, propertyId: id, ownerId: owner.id, name, county, town, address, description: `${name} is a well-kept residential property in ${town}.`, amenities, verified, verifiedAt: verified ? Date.now() : null, status: 'active' });
  };
  const p1 = mkProp(grace, 'Sunrise Apartments', 'Nairobi', 'Kilimani', 'Argwings Kodhek Rd', true, ['Water 24/7', 'Parking', 'CCTV', 'Security guard', 'Backup generator']);
  const p2 = mkProp(grace, 'Lakeview Court', 'Kisumu', 'Milimani', 'Tom Mboya Rd', false, ['Water 24/7', 'Parking', 'Gated compound']);
  const p3 = mkProp(peter, 'Palm Gardens', 'Mombasa', 'Nyali', 'Links Rd', true, ['Borehole', 'Gated compound', 'Pets allowed']);

  const mkUnit = (p, name, type, bedrooms, rent, listed) => db.units.insert({ ownerId: p.ownerId, propertyId: p.id, name, type, bedrooms, rent, deposit: rent, listed: !!listed, status: 'vacant', vacantSince: U.addDays(today, -Math.floor(Math.random() * 40) - 3), tenantId: null, leaseId: null, description: '' });
  const u1 = [['A1', 'Bedsitter', 0, 9000], ['A2', 'Bedsitter', 0, 9000], ['B1', '1 Bedroom', 1, 18000], ['B2', '1 Bedroom', 1, 18000], ['B3', '1 Bedroom', 1, 19000], ['C1', '2 Bedroom', 2, 32000], ['C2', '2 Bedroom', 2, 32000], ['C3', '2 Bedroom', 2, 34000]].map((x) => mkUnit(p1, ...x, x[0] === 'C3' || x[0] === 'B3'));
  const u2 = [['101', '1 Bedroom', 1, 14000], ['102', '1 Bedroom', 1, 14000], ['201', '2 Bedroom', 2, 22000], ['202', '2 Bedroom', 2, 22000], ['301', '3 Bedroom', 3, 30000]].map((x) => mkUnit(p2, ...x, x[0] === '301'));
  const u3 = [['G1', '2 Bedroom', 2, 40000], ['G2', '2 Bedroom', 2, 40000], ['G3', '3 Bedroom', 3, 55000]].map((x) => mkUnit(p3, ...x, x[0] === 'G3'));

  const mgrA = add('Property Manager (Sunrise only)', await mk({ role: 'property_manager', ownerId: grace.id, name: 'Brian Kimani', email: 'brian@example.com', phone: '254711000011', assignedPropertyIds: [p1.id], approvalLimit: 20000, status: 'active' }, pw()));
  const mgrB = add('Property Manager (Lakeview only)', await mk({ role: 'property_manager', ownerId: grace.id, name: 'Faith Achieng', email: 'faith@example.com', phone: '254711000012', assignedPropertyIds: [p2.id], approvalLimit: 50000, status: 'active' }, pw()));
  const care = add('Caretaker (Sunrise)', await mk({ role: 'caretaker', ownerId: grace.id, name: 'Joseph Mwangi', phone: '254711000021', assignedPropertyIds: [p1.id], status: 'active' }, pw()));
  const team = db.contractors.insert({ ownerId: grace.id, name: 'QuickFix Plumbers & Electricians', trade: 'Plumbing / Electrical', phone: '254711000031', active: true });
  const team2 = db.contractors.insert({ ownerId: grace.id, name: 'Bright Painters', trade: 'Painting', phone: '254711000032', active: true });
  add('Contractor team login', await mk({ role: 'contractor', ownerId: grace.id, name: 'Samuel (QuickFix)', phone: '254711000032'.replace('32', '33'), contractorId: team.id, status: 'active' }, pw()));

  // tenants + leases
  const names = ['Mary Njeri', 'John Kamau', 'Aisha Mohamed', 'David Otieno', 'Lucy Wambui', 'Hassan Ali', 'Esther Akinyi', 'Kevin Mutua', 'Naomi Chebet', 'Samuel Kiptoo', 'Janet Moraa', 'Peter Njoroge', 'Rose Atieno', 'Daniel Ochieng'];
  const tenants = [];
  const startLease = async (unit, idx, owner, mgr, startOffsetMonths) => {
    const nm = names[idx % names.length];
    const t = await mk({ role: 'tenant', ownerId: owner.id, name: nm, phone: '2547200000' + String(10 + idx), email: undefined, propertyId: unit.propertyId, unitId: unit.id, tenancy: 'current', status: 'active' }, pw());
    const start = U.addMonths(cur, -startOffsetMonths) + '-01';
    S.tx(() => {
      const lease = db.leases.insert({ ownerId: owner.id, propertyId: unit.propertyId, unitId: unit.id, tenantId: t.id, rent: unit.rent, deposit: unit.deposit, dueDay: 5, startDate: start, endDate: idx % 5 === 0 ? U.addDays(today, 25) : null, status: 'active', credit: 0, notes: '' });
      db.units.update(unit.id, { status: 'occupied', tenantId: t.id, leaseId: lease.id, listed: false });
      db.users.update(t.id, { leaseId: lease.id });
      D.createInvoice(lease, { type: 'deposit', period: null, desc: 'Security deposit', amount: unit.deposit, dueDate: start });
      D.generateForLease(lease);
      tenants.push({ t, lease, unit, owner });
    });
    return t;
  };
  let idx = 0;
  const occupy = { p1: u1.slice(0, 6), p2: u2.slice(0, 4), p3: u3.slice(0, 2) };
  for (const u of occupy.p1) await startLease(u, idx++, grace, mgrA, 3 + (idx % 3));
  for (const u of occupy.p2) await startLease(u, idx++, grace, mgrB, 2 + (idx % 2));
  for (const u of occupy.p3) await startLease(u, idx++, peter, null, 2);
  add('Tenant (Sunrise A1)', tenants[0].t); add('Tenant (Sunrise A2)', tenants[1].t);

  // payment history: most pay on time, a few late, two in arrears
  let n = 0;
  for (const { t, lease, unit } of tenants) {
    n++;
    const invs = db.invoices.where('leaseId', lease.id).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    for (const inv of invs) {
      const isCurrent = inv.period === cur;
      const behind = n % 7 === 0 || n % 11 === 0; // these tenants are in arrears
      if (behind && (isCurrent || inv.period === U.addMonths(cur, -1))) continue;
      if (isCurrent && (n % 3 === 0 || n === 1)) continue; // not yet paid this month
      const when = Date.parse(inv.dueDate + 'T10:00:00+03:00') - (n % 4) * 86400000;
      if (when > Date.now()) continue;
      const method = ['mpesa', 'mpesa', 'mpesa', 'bank', 'cash'][n % 5];
      const p = db.payments.insert({ ownerId: lease.ownerId, propertyId: lease.propertyId, unitId: lease.unitId, leaseId: lease.id, tenantId: t.id, amount: inv.amount - inv.paid, method, status: 'pending', manual: method !== 'mpesa', simulated: method === 'mpesa', ...(method === 'mpesa' ? { providerRef: 'S' + sec.randomToken(7).toUpperCase().replace(/[-_]/g, 'K') } : method === 'bank' ? { providerRef: 'BK' + sec.randomToken(6).toUpperCase().replace(/[-_]/g, 'Z') } : {}) });
      D.completePayment(p.id, { paidAt: Math.min(when, Date.now()) });
    }
  }
  // expenses
  const cats = [['Repairs & maintenance', 'Fix leaking tap in B2', 3500], ['Utilities (water/electricity)', 'Common area electricity', 6200], ['Security', 'Guard salary', 18000], ['Cleaning & garbage', 'Garbage collection', 4000], ['Caretaker / staff wages', 'Caretaker salary', 15000]];
  for (let m = 0; m < 3; m++) for (const [c, d, a] of cats) db.expenses.insert({ ownerId: grace.id, propertyId: m % 2 ? p2.id : p1.id, category: c, description: d, amount: a + m * 150, date: U.addMonths(cur, -m) + '-' + String(8 + m).padStart(2, '0'), vendor: '', createdBy: grace.id });
  // maintenance
  const t0 = tenants[0];
  db.maintenance.insert({ ownerId: grace.id, propertyId: p1.id, unitId: t0.unit.id, tenantId: t0.t.id, reportedBy: t0.t.id, reporterRole: 'tenant', title: 'Kitchen sink is leaking', description: 'Water drips under the sink since yesterday.', category: 'Plumbing', priority: 'urgent', status: 'submitted', estimate: null, cost: null, contractorId: null, notes: [{ by: t0.t.name, role: 'tenant', at: Date.now(), text: 'Request submitted' }] });
  db.maintenance.insert({ ownerId: grace.id, propertyId: p1.id, unitId: tenants[2].unit.id, tenantId: tenants[2].t.id, reportedBy: tenants[2].t.id, reporterRole: 'tenant', title: 'Bedroom socket not working', description: '', category: 'Electrical', priority: 'normal', status: 'assigned', estimate: 2500, cost: null, contractorId: team.id, assignedAt: Date.now() - 86400000, notes: [{ by: 'Brian Kimani', role: 'property_manager', at: Date.now(), text: 'Approved' }] });
  db.maintenance.insert({ ownerId: grace.id, propertyId: p1.id, unitId: tenants[1].unit.id, tenantId: tenants[1].t.id, reportedBy: tenants[1].t.id, reporterRole: 'tenant', title: 'Repaint ceiling after leak', description: '', category: 'Painting', priority: 'low', status: 'completed', estimate: 12000, cost: 11500, contractorId: team2.id, assignedAt: Date.now() - 12 * 86400000, completedAt: Date.now() - 4 * 86400000, rating: 5, notes: [] });
  // inspection
  db.inspections.insert({ ownerId: grace.id, propertyId: p1.id, unitId: null, type: 'routine', date: U.addDays(today, -9), items: [{ label: 'Gate, fence and security lights', result: 'pass', note: '' }, { label: 'Water supply and pressure', result: 'pass', note: '' }, { label: 'Garbage area', result: 'fail', note: 'Overflowing bins' }], notes: '', inspectorId: care.id, inspectorName: care.name, passed: 2, failed: 1, score: 67, jobsCreated: 0 });
  db.messages.insert({ ownerId: grace.id, propertyId: p1.id, tenantId: t0.t.id, fromId: t0.t.id, fromName: t0.t.name, fromRole: 'tenant', text: 'Hello, can someone check the sink today please?', readBy: [t0.t.id] });
  db.inquiries.insert({ ownerId: grace.id, propertyId: p1.id, unitId: u1[7].id, name: 'Christine Waithera', phone: '254722123456', message: 'Is the 2 bedroom still available?', status: 'new' });
  log('Demo data created.');
  return { creds, grace, peter, mgrA, mgrB, care, p1, p2, p3 };
}

module.exports = { seed };

if (require.main === module) {
  S.open(); sec.master();
  seed().then(({ creds }) => {
    console.log('\nSign-in details (random passwords, shown once):\n');
    for (const c of creds) console.log(`  ${c.label.padEnd(34)} ${String(c.login).padEnd(24)} ${c.password}`);
    console.log('\nNOTE: demo data is for trying the system. Delete the data folder and set up again before real use.\n');
    S.close();
  }).catch((e) => { console.error(e.message); process.exit(1); });
}
