'use strict';
// THE REAL-ESTATE ECOSYSTEM: properties and land for sale, lead pipeline and deals, short stays, development projects,
// building assets, compliance records, and the services marketplace (providers). Same rules as the rest of the system:
// every request is permission-checked, every record is scoped to the landlord organisation, every change is audited.
const S = require('../store');
const { db } = S;
const U = require('../util');
const { E, clean } = U;
const H = require('../http');
const D = require('../domain');
const P = require('../platform');
const R = require('../roles');

const r2 = D.r2;
const KINDS = ['house', 'apartment', 'townhouse', 'bungalow', 'maisonette', 'land', 'commercial', 'farm', 'warehouse', 'other'];
const TITLES = ['freehold', 'leasehold', 'sectional', 'community_land', 'allotment_letter', 'unknown'];
const SALE_STATUS = ['draft', 'active', 'under_offer', 'sold', 'withdrawn'];
const STAGES = ['new', 'contacted', 'viewing', 'negotiation', 'won', 'lost'];
const PROVIDER_CATEGORIES = ['valuer', 'land_surveyor', 'architect', 'engineer', 'quantity_surveyor', 'advocate', 'conveyancer', 'mortgage_broker', 'insurer', 'mover', 'cleaner', 'security', 'builder', 'interior_designer', 'photographer', 'pest_control', 'plumber', 'electrician', 'landscaper', 'other'];
const ASSET_CATS = ['lift', 'generator', 'borehole_pump', 'water_tank', 'solar', 'fire_safety', 'cctv', 'gate_access', 'hvac', 'transformer', 'other'];
const COMPLIANCE_KINDS = ['insurance', 'fire_safety', 'business_permit', 'land_rates', 'lift_inspection', 'occupancy_certificate', 'nema_licence', 'lease_registration', 'valuation', 'title_search', 'other'];

const propName = (id) => (db.properties.get(id) || {}).name || '';
const unitName = (id) => (db.units.get(id) || {}).name || '';
const addMonths = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); };
function checkProp(ctx, propertyId) { return propertyId ? D.getProperty(propertyId, ctx).id : null; }

/* ====================================================================================== */
/* SALES: houses, apartments, plots, farms and commercial space for sale                  */
/* ====================================================================================== */
const SALE_F = {
  title: { t: 's', req: true, min: 3, max: 120, label: 'Title' }, kind: { t: 'e', values: KINDS, req: true, label: 'Type' }, propertyId: { t: 'id' },
  county: { t: 's', req: true, max: 40, label: 'County' }, town: { t: 's', req: true, max: 60, label: 'Town / area' }, address: { t: 's', max: 160 },
  price: { t: 'n', req: true, min: 1, max: 1e11, label: 'Price' }, negotiable: { t: 'b' }, sizeValue: { t: 'n', max: 1e9 }, sizeUnit: { t: 'e', values: ['sqm', 'sqft', 'acres', 'hectares', 'plot'] },
  bedrooms: { t: 'n', int: true, max: 50 }, bathrooms: { t: 'n', int: true, max: 50 }, titleType: { t: 'e', values: TITLES, def: 'unknown', label: 'Title type' },
  description: { t: 's', max: 2000 }, features: { t: 'strs', max: 20 }, tourUrl: { t: 's', max: 300, re: /^https:\/\/[^\s]+$/ }, status: { t: 'e', values: SALE_STATUS },
};
const isPublicSale = (s) => {
  if (!s || !s.verified || !['active', 'under_offer'].includes(s.status)) return false;
  const o = db.users.get(s.ownerId); return !!o && o.status === 'active';
};
const saleMedia = (s) => db.files.where('refId', s.id).filter((f) => f.refType === 'sale').sort((a, b) => a.createdAt - b.createdAt).map((f) => ({ id: f.id, kind: f.mime === 'application/pdf' ? 'doc' : 'photo', name: f.name }));
const saleView = (s, full) => ({
  id: s.id, title: s.title, kind: s.kind, county: s.county, town: s.town, price: s.price, negotiable: !!s.negotiable, sizeValue: s.sizeValue || null, sizeUnit: s.sizeUnit || null,
  bedrooms: s.bedrooms ?? null, bathrooms: s.bathrooms ?? null, titleType: s.titleType, description: s.description || '', features: s.features || [], tourUrl: s.tourUrl || '', status: s.status,
  postedAt: s.listedAt || s.createdAt, media: saleMedia(s).filter((m) => full || m.kind === 'photo'),
});
const ownerSaleView = (s) => ({ ...s, tokenHash: undefined, propertyName: s.propertyId ? propName(s.propertyId) : '', media: saleMedia(s), enquiries: db.leads.where('saleId', s.id).length, publicNow: isPublicSale(s) });

H.route('GET', '/api/sales', { perm: 'sales.read' }, async (ctx) => {
  const rows = D.orgList(db.sales, ctx).sort((a, b) => b.updatedAt - a.updatedAt);
  return { sales: rows.map(ownerSaleView), kinds: KINDS, titles: TITLES, statuses: SALE_STATUS };
});
H.route('POST', '/api/sales', { perm: 'sales.write', rate: [60, 3600000] }, async (ctx) => {
  const b = clean(ctx.body, SALE_F);
  P.assertCanGrow(ctx.scope.ownerId);
  const propertyId = checkProp(ctx, b.propertyId);
  const prop = propertyId ? db.properties.get(propertyId) : null;
  const s = db.sales.insert({ ...b, ownerId: ctx.scope.ownerId, propertyId, status: b.status || 'draft', verified: !!(prop && prop.verified), createdBy: ctx.user.id, listedAt: b.status === 'active' ? Date.now() : null });
  D.audit(ctx, 'sale.created', 'sale', s.id, { title: s.title, price: s.price });
  if (!s.verified && s.status === 'active') for (const a of db.users.where('role', 'national_admin')) D.notify(a.id, 'Sale listing waiting for verification', `${s.title} (${s.town}) - KES ${s.price.toLocaleString()}`, 'admin', '#/admin/marketplace');
  return { sale: ownerSaleView(s) };
});
H.route('PUT', '/api/sales/:id', { perm: 'sales.write' }, async (ctx) => {
  const s = D.orgGet(db.sales, ctx.params.id, ctx);
  const b = clean(ctx.body, { ...Object.fromEntries(Object.entries(SALE_F).map(([k, v]) => [k, { ...v, req: false, def: undefined }])), version: { t: 'n', int: true } });
  const { version, ...patch } = b;
  if (patch.propertyId) patch.propertyId = checkProp(ctx, patch.propertyId);
  if (s.status === 'sold' && patch.status && patch.status !== 'sold') throw E.conflict('A sold listing cannot be re-opened. Create a new listing.');
  const prop = (patch.propertyId || s.propertyId) ? db.properties.get(patch.propertyId || s.propertyId) : null;
  const sensitive = ['titleType', 'county', 'town', 'kind'].some((k) => patch[k] !== undefined && patch[k] !== s[k]);
  if (sensitive && !(prop && prop.verified)) patch.verified = false; // identity of the thing being sold changed: verify again
  if (patch.status === 'active' && !s.listedAt) patch.listedAt = Date.now();
  const up = db.sales.update(s.id, patch, version);
  D.audit(ctx, 'sale.updated', 'sale', s.id, { status: up.status, price: up.price });
  if (!up.verified && up.status === 'active' && s.verified !== up.verified) for (const a of db.users.where('role', 'national_admin')) D.notify(a.id, 'Sale listing waiting for verification', `${up.title} (${up.town})`, 'admin', '#/admin/marketplace');
  return { sale: ownerSaleView(up) };
});
H.route('DELETE', '/api/sales/:id', { perm: 'sales.write' }, async (ctx) => {
  const s = D.orgGet(db.sales, ctx.params.id, ctx);
  if (db.deals.where('saleId', s.id).some((d) => d.status === 'closed')) throw E.conflict('This listing has a closed deal and is kept for your records. Mark it as withdrawn instead.');
  for (const f of db.files.where('refId', s.id)) { db.files.remove(f.id); try { require('fs').unlinkSync(require('path').join(require('../config').paths.files, f.id + '.enc')); } catch { /* ignore */ } }
  db.sales.remove(s.id); D.audit(ctx, 'sale.deleted', 'sale', s.id, { title: s.title });
  return { ok: true };
});

/* ---------- public: browse and enquire ---------- */
const SQ = { county: { t: 's', max: 40 }, q: { t: 's', max: 60 }, kind: { t: 'e', values: KINDS }, minPrice: { t: 'n', max: 1e11 }, maxPrice: { t: 'n', max: 1e11 }, bedrooms: { t: 'n', int: true, max: 50 }, titleType: { t: 'e', values: TITLES } };
function publicSales(q) {
  let rows = db.sales.all().filter(isPublicSale);
  if (q.county) rows = rows.filter((s) => s.county.toLowerCase() === q.county.toLowerCase());
  if (q.kind) rows = rows.filter((s) => s.kind === q.kind);
  if (q.titleType) rows = rows.filter((s) => s.titleType === q.titleType);
  if (q.q) { const t = q.q.toLowerCase(); rows = rows.filter((s) => `${s.title} ${s.town} ${s.description || ''}`.toLowerCase().includes(t)); }
  if (q.minPrice !== undefined) rows = rows.filter((s) => s.price >= q.minPrice);
  if (q.maxPrice !== undefined) rows = rows.filter((s) => s.price <= q.maxPrice);
  if (q.bedrooms !== undefined) rows = rows.filter((s) => (s.bedrooms || 0) >= q.bedrooms);
  return rows.sort((a, b) => (b.listedAt || b.createdAt) - (a.listedAt || a.createdAt));
}
H.route('GET', '/api/public/sales', { public: true, rate: [60, 60000] }, async (ctx) => {
  if (!P.config().listingsPublic) return { sales: [], kinds: KINDS, titles: TITLES };
  return { sales: publicSales(clean(ctx.query, SQ)).slice(0, 200).map((s) => saleView(s)), kinds: KINDS, titles: TITLES };
});
H.route('GET', '/api/public/sales/:id', { public: true, rate: [120, 60000] }, async (ctx) => {
  const s = db.sales.get(ctx.params.id);
  if (!P.config().listingsPublic || !isPublicSale(s)) throw E.notFound('This property is no longer available');
  return { sale: saleView(s, true) };
});
H.route('POST', '/api/public/sales/:id/enquiry', { public: true, rate: [6, 600000] }, async (ctx) => {
  const b = clean(ctx.body, { name: { t: 's', req: true, min: 2, max: 80 }, phone: { t: 'phone', req: true }, message: { t: 's', max: 400 }, consent: { t: 'b' }, website: { t: 's', max: 50 } });
  if (b.website) return { ok: true };
  if (!b.consent) throw E.bad('Please tick the box to allow the seller or agent to contact you about this property.');
  const s = db.sales.get(ctx.params.id);
  if (!P.config().listingsPublic || !isPublicSale(s)) throw E.notFound('This property is no longer available');
  if (db.leads.where('phone', b.phone).filter((l) => l.saleId === s.id && l.createdAt > Date.now() - 864e5).length) throw E.conflict('You already sent an enquiry about this property. The seller will contact you.');
  const lead = db.leads.insert({ ownerId: s.ownerId, propertyId: s.propertyId || null, saleId: s.id, name: b.name, phone: b.phone, interest: 'buy', source: 'listing', stage: 'new', notes: b.message ? [{ at: Date.now(), by: null, byName: b.name, text: b.message }] : [], consent: { given: true, at: Date.now(), purpose: 'contact about ' + s.title, ip: ctx.ip } });
  db.consents.insert({ subject: b.phone, purpose: 'sale_enquiry', legalVersion: require('../legal').VERSION, refId: lead.id, ip: ctx.ip });
  D.notifyOrg(s.ownerId, s.propertyId, 'New buyer enquiry', `${b.name} is interested in "${s.title}" (${s.town}).`, 'lead', '#/leads');
  D.smsTo(s.ownerId, b.phone, `Thanks ${b.name.split(' ')[0]}, we received your enquiry about "${s.title}". The seller or agent will call you.`);
  return { ok: true, message: 'Thank you! The seller or agent will contact you shortly.' };
});

/* ---------- National Administration: verify sale listings ---------- */
H.route('GET', '/api/admin/sales', { perm: 'platform.providers' }, async (ctx) => {
  const f = ctx.query.verified === '1' ? true : ctx.query.verified === '0' ? false : null;
  const rows = db.sales.all().filter((s) => s.status !== 'draft' && (f === null || !!s.verified === f)).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 300);
  return { sales: rows.map((s) => ({ ...saleView(s, true), verified: !!s.verified, ownerName: ((db.users.get(s.ownerId) || {}).company || (db.users.get(s.ownerId) || {}).name || ''), propertyLinked: !!s.propertyId })) };
});
H.route('POST', '/api/admin/sales/:id/verify', { perm: 'platform.providers', rate: [120, 60000] }, async (ctx) => {
  const b = clean(ctx.body, { verified: { t: 'b', req: true }, note: { t: 's', max: 200 } });
  const s = db.sales.get(ctx.params.id); if (!s) throw E.notFound();
  const up = db.sales.update(s.id, { verified: b.verified, verifyNote: b.note || '', verifiedAt: b.verified ? Date.now() : null, verifiedBy: ctx.user.id });
  D.notify(s.ownerId, b.verified ? 'Sale listing verified' : 'Sale listing not verified', `${s.title}: ${b.verified ? 'now visible to the public.' : (b.note || 'please contact support.')}`, 'sale', '#/sales');
  S.audit.append({ owner: s.ownerId, actor: ctx.user.id, role: ctx.user.role, action: b.verified ? 'sale.verified' : 'sale.unverified', entity: 'sale', entityId: s.id, ip: ctx.ip, detail: { note: b.note || '' } });
  return { sale: { id: up.id, verified: up.verified } };
});

/* ====================================================================================== */
/* LEADS (CRM) and DEALS                                                                  */
/* ====================================================================================== */
const LEAD_F = {
  name: { t: 's', req: true, min: 2, max: 80 }, phone: { t: 'phone' }, email: { t: 'email' }, interest: { t: 'e', values: ['buy', 'rent', 'sell', 'invest', 'other'], def: 'buy' },
  budgetMin: { t: 'n', max: 1e11 }, budgetMax: { t: 'n', max: 1e11 }, source: { t: 'e', values: ['walk_in', 'phone', 'website', 'listing', 'referral', 'social', 'other'], def: 'phone' },
  stage: { t: 'e', values: STAGES }, saleId: { t: 'id' }, unitId: { t: 'id' }, propertyId: { t: 'id' }, assignedTo: { t: 'id' }, nextFollowUp: { t: 'd' }, lostReason: { t: 's', max: 160 }, preferences: { t: 's', max: 300 },
  consent: { t: 'b' },
};
const leadView = (l) => ({ ...l, saleTitle: l.saleId ? (db.sales.get(l.saleId) || {}).title || '' : '', unitName: l.unitId ? unitName(l.unitId) : '', propertyName: l.propertyId ? propName(l.propertyId) : '', assignedName: l.assignedTo ? (db.users.get(l.assignedTo) || {}).name || '' : '' });
function leadLinks(ctx, b) {
  if (b.propertyId) checkProp(ctx, b.propertyId);
  if (b.saleId) D.orgGet(db.sales, b.saleId, ctx);
  if (b.unitId) D.getScoped(db.units, b.unitId, ctx);
  if (b.assignedTo) { const u = db.users.get(b.assignedTo); if (!u || u.ownerId !== ctx.scope.ownerId || !['landlord', 'property_manager'].includes(u.role)) throw E.bad('Choose a manager of your organisation'); }
}
H.route('GET', '/api/leads', { perm: 'lead.read' }, async (ctx) => {
  let rows = D.orgList(db.leads, ctx);
  const { stage, q, interest } = ctx.query;
  const counts = Object.fromEntries(STAGES.map((s) => [s, rows.filter((l) => l.stage === s).length]));
  if (stage) rows = rows.filter((l) => l.stage === stage);
  if (interest) rows = rows.filter((l) => l.interest === interest);
  if (q) { const t = String(q).toLowerCase(); rows = rows.filter((l) => `${l.name} ${l.phone || ''} ${l.email || ''}`.toLowerCase().includes(t)); }
  rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const staff = ctx.scope.all ? db.users.byOwner(ctx.scope.ownerId).filter((u) => u.role === 'property_manager' && u.status === 'active').map((u) => ({ id: u.id, name: u.name })) : [];
  return { leads: rows.slice(0, 500).map(leadView), counts, stages: STAGES, staff };
});
H.route('POST', '/api/leads', { perm: 'lead.write', rate: [200, 3600000] }, async (ctx) => {
  const b = clean(ctx.body, LEAD_F);
  if (!b.phone && !b.email) throw E.bad('Enter a phone number or an email address for this lead');
  leadLinks(ctx, b);
  const l = db.leads.insert({ ...b, ownerId: ctx.scope.ownerId, stage: b.stage || 'new', notes: [], createdBy: ctx.user.id, consent: { given: !!b.consent, at: Date.now(), purpose: 'sales / rental follow-up', by: ctx.user.id } });
  D.audit(ctx, 'lead.created', 'lead', l.id, { source: l.source });
  return { lead: leadView(l) };
});
H.route('PUT', '/api/leads/:id', { perm: 'lead.write' }, async (ctx) => {
  const l = D.orgGet(db.leads, ctx.params.id, ctx);
  const f = Object.fromEntries(Object.entries(LEAD_F).map(([k, v]) => [k, { ...v, req: false, def: undefined }]));
  const b = clean(ctx.body, { ...f, version: { t: 'n', int: true } });
  const { version, consent, ...patch } = b;
  leadLinks(ctx, patch);
  if (patch.stage === 'won' && l.stage !== 'won') throw E.bad('Record a deal to mark a lead as won.', 'use_deal');
  const up = db.leads.update(l.id, patch, version);
  D.audit(ctx, 'lead.updated', 'lead', l.id, { stage: up.stage });
  return { lead: leadView(up) };
});
H.route('POST', '/api/leads/:id/note', { perm: 'lead.write', rate: [300, 3600000] }, async (ctx) => {
  const l = D.orgGet(db.leads, ctx.params.id, ctx);
  const b = clean(ctx.body, { text: { t: 's', req: true, max: 500, label: 'Note' }, nextFollowUp: { t: 'd' } });
  const up = db.leads.update(l.id, (x) => { x.notes = [...(x.notes || []), { at: Date.now(), by: ctx.user.id, byName: ctx.user.name, text: b.text }].slice(-100); if (b.nextFollowUp) x.nextFollowUp = b.nextFollowUp; if (x.stage === 'new') x.stage = 'contacted'; return x; });
  return { lead: leadView(up) };
});
H.route('DELETE', '/api/leads/:id', { perm: 'lead.write' }, async (ctx) => {
  const l = D.orgGet(db.leads, ctx.params.id, ctx);
  if (!ctx.scope.all && l.createdBy !== ctx.user.id) throw E.forbidden('Only the landlord can delete a lead that someone else created.');
  if (db.deals.where('leadId', l.id).length) throw E.conflict('This lead has a deal attached, so it is kept for your records.');
  db.leads.remove(l.id); D.audit(ctx, 'lead.deleted', 'lead', l.id, {}); return { ok: true };
});

const DEAL_F = { leadId: { t: 'id' }, saleId: { t: 'id' }, unitId: { t: 'id' }, type: { t: 'e', values: ['sale', 'rental', 'referral'], req: true }, price: { t: 'n', req: true, min: 1, max: 1e11, label: 'Deal value' }, commissionPct: { t: 'n', max: 100, def: 0 }, commissionFixed: { t: 'n', max: 1e10, def: 0 }, clientName: { t: 's', max: 80 }, note: { t: 's', max: 300 } };
const commission = (d) => r2((d.price * (d.commissionPct || 0)) / 100 + (d.commissionFixed || 0));
const dealView = (d) => ({ ...d, commission: commission(d), saleTitle: d.saleId ? (db.sales.get(d.saleId) || {}).title || '' : '', leadName: d.leadId ? (db.leads.get(d.leadId) || {}).name || '' : '', unitName: d.unitId ? unitName(d.unitId) : '' });
H.route('GET', '/api/deals', { perm: 'lead.read' }, async (ctx) => {
  const rows = D.orgList(db.deals, ctx).sort((a, b) => b.createdAt - a.createdAt);
  const closed = rows.filter((d) => d.status === 'closed');
  return { deals: rows.slice(0, 500).map(dealView), totals: { open: rows.filter((d) => d.status === 'open').length, closed: closed.length, value: r2(closed.reduce((a, d) => a + d.price, 0)), commission: r2(closed.reduce((a, d) => a + commission(d), 0)), pipelineValue: r2(rows.filter((d) => d.status === 'open').reduce((a, d) => a + d.price, 0)) } };
});
H.route('POST', '/api/deals', { perm: 'lead.write', rate: [200, 3600000] }, async (ctx) => {
  const b = clean(ctx.body, DEAL_F);
  let lead = null;
  if (b.leadId) lead = D.orgGet(db.leads, b.leadId, ctx);
  if (b.saleId) { const s = D.orgGet(db.sales, b.saleId, ctx); if (s.status === 'sold') throw E.conflict('That property is already sold.'); }
  if (b.unitId) D.getScoped(db.units, b.unitId, ctx);
  const d = db.deals.insert({ ...b, ownerId: ctx.scope.ownerId, propertyId: (b.saleId && (db.sales.get(b.saleId) || {}).propertyId) || (b.unitId && (db.units.get(b.unitId) || {}).propertyId) || null, status: 'open', createdBy: ctx.user.id });
  if (lead && ['new', 'contacted', 'viewing'].includes(lead.stage)) db.leads.update(lead.id, { stage: 'negotiation' });
  if (b.saleId) { const s = db.sales.get(b.saleId); if (s.status === 'active') db.sales.update(s.id, { status: 'under_offer' }); }
  D.audit(ctx, 'deal.created', 'deal', d.id, { type: d.type, price: d.price });
  return { deal: dealView(d) };
});
H.route('PUT', '/api/deals/:id', { perm: 'lead.write' }, async (ctx) => {
  const d = D.orgGet(db.deals, ctx.params.id, ctx);
  if (d.status !== 'open') throw E.conflict('This deal is already ' + d.status + ' and can no longer be changed.');
  const b = clean(ctx.body, { status: { t: 'e', values: ['open', 'closed', 'cancelled'] }, price: DEAL_F.price && { ...DEAL_F.price, req: false }, commissionPct: { t: 'n', max: 100 }, commissionFixed: { t: 'n', max: 1e10 }, clientName: { t: 's', max: 80 }, note: { t: 's', max: 300 }, version: { t: 'n', int: true } });
  const { version, ...patch } = b;
  if (patch.status === 'closed') patch.closedAt = Date.now();
  const up = db.deals.update(d.id, patch, version);
  if (up.status === 'closed') {
    if (up.leadId) db.leads.update(up.leadId, { stage: 'won' });
    if (up.saleId && up.type === 'sale') db.sales.update(up.saleId, { status: 'sold', soldPrice: up.price, soldAt: Date.now() });
    D.audit(ctx, 'deal.closed', 'deal', d.id, { price: up.price, commission: commission(up) });
  } else if (up.status === 'cancelled') {
    if (up.saleId) { const s = db.sales.get(up.saleId); if (s && s.status === 'under_offer' && !db.deals.where('saleId', s.id).some((x) => x.status === 'open' && x.id !== up.id)) db.sales.update(s.id, { status: 'active' }); }
    if (up.leadId) { const l = db.leads.get(up.leadId); if (l && l.stage === 'negotiation') db.leads.update(l.id, { stage: 'viewing' }); }
  }
  return { deal: dealView(up) };
});

/* ====================================================================================== */
/* SHORT STAYS                                                                            */
/* ====================================================================================== */
const STAY_F = { unitId: { t: 'id', req: true }, guestName: { t: 's', req: true, min: 2, max: 80, label: 'Guest name' }, guestPhone: { t: 'phone' }, guests: { t: 'n', int: true, min: 1, max: 50, def: 1 }, checkIn: { t: 'd', req: true, label: 'Check-in' }, checkOut: { t: 'd', req: true, label: 'Check-out' }, nightlyRate: { t: 'n', req: true, min: 1, max: 1e8, label: 'Nightly rate' }, cleaningFee: { t: 'n', max: 1e7, def: 0 }, source: { t: 'e', values: ['direct', 'airbnb', 'booking_com', 'other'], def: 'direct' }, notes: { t: 's', max: 300 } };
const nights = (a, b) => U.daysBetween(a, b);
const stayView = (s) => ({ ...s, unitName: unitName(s.unitId), propertyName: propName(s.propertyId), balance: r2(s.total - (s.paid || 0)) });
H.route('GET', '/api/stays', { perm: 'stay.read' }, async (ctx) => {
  let rows = D.listScoped(db.stays, ctx);
  const q = ctx.query;
  if (q.propertyId) rows = rows.filter((s) => s.propertyId === q.propertyId);
  if (q.status) rows = rows.filter((s) => s.status === q.status);
  if (q.from) rows = rows.filter((s) => s.checkOut >= q.from);
  if (q.to) rows = rows.filter((s) => s.checkIn <= q.to);
  rows.sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  const live = rows.filter((s) => s.status !== 'cancelled');
  const month = U.todayStr().slice(0, 7);
  return { stays: rows.slice(-500).map(stayView), totals: { bookings: live.length, revenue: r2(live.reduce((a, s) => a + s.total, 0)), collected: r2(live.reduce((a, s) => a + (s.paid || 0), 0)), thisMonthNights: live.filter((s) => s.checkIn.startsWith(month)).reduce((a, s) => a + s.nights, 0) } };
});
function overlapping(unitId, checkIn, checkOut, exceptId) {
  return db.stays.where('unitId', unitId).filter((s) => s.id !== exceptId && ['booked', 'checked_in'].includes(s.status) && s.checkIn < checkOut && checkIn < s.checkOut);
}
H.route('POST', '/api/stays', { perm: 'stay.write', rate: [200, 3600000] }, async (ctx) => {
  const b = clean(ctx.body, STAY_F);
  const unit = D.getScoped(db.units, b.unitId, ctx);
  const n = nights(b.checkIn, b.checkOut);
  if (n < 1) throw E.bad('Check-out must be after check-in');
  if (n > 90) throw E.bad('A short stay is limited to 90 nights. For longer stays create a lease.');
  if (b.checkOut < U.todayStr()) throw E.bad('That stay is already over. Choose future or current dates.');
  if (unit.status === 'occupied') throw E.conflict('This unit has a long-term tenant. Short stays are only for vacant units.');
  if (overlapping(unit.id, b.checkIn, b.checkOut).length) throw E.conflict('This unit is already booked for some of those nights.');
  const total = r2(n * b.nightlyRate + (b.cleaningFee || 0));
  const s = db.stays.insert({ ...b, ownerId: unit.ownerId, propertyId: unit.propertyId, nights: n, total, paid: 0, status: 'booked', createdBy: ctx.user.id });
  D.audit(ctx, 'stay.created', 'stay', s.id, { unit: unit.name, nights: n, total });
  return { stay: stayView(s) };
});
H.route('PUT', '/api/stays/:id', { perm: 'stay.write' }, async (ctx) => {
  const s = D.getScoped(db.stays, ctx.params.id, ctx);
  if (['checked_out', 'cancelled'].includes(s.status)) throw E.conflict('This booking is closed.');
  const b = clean(ctx.body, { guestName: { t: 's', min: 2, max: 80 }, guestPhone: { t: 'phone' }, guests: { t: 'n', int: true, min: 1, max: 50 }, checkIn: { t: 'd' }, checkOut: { t: 'd' }, nightlyRate: { t: 'n', min: 1, max: 1e8 }, cleaningFee: { t: 'n', max: 1e7 }, paid: { t: 'n', max: 1e9 }, notes: { t: 's', max: 300 }, version: { t: 'n', int: true } });
  const { version, ...patch } = b;
  const m = { ...s, ...patch }; const n = nights(m.checkIn, m.checkOut);
  if (n < 1 || n > 90) throw E.bad('Check the dates: a stay is 1 to 90 nights');
  if (overlapping(s.unitId, m.checkIn, m.checkOut, s.id).length) throw E.conflict('Those dates clash with another booking.');
  patch.nights = n; patch.total = r2(n * m.nightlyRate + (m.cleaningFee || 0));
  if ((m.paid || 0) > patch.total + 0.004) throw E.bad('Amount paid is more than the total');
  const up = db.stays.update(s.id, patch, version);
  D.audit(ctx, 'stay.updated', 'stay', s.id, { total: up.total, paid: up.paid });
  return { stay: stayView(up) };
});
H.route('POST', '/api/stays/:id/status', { perm: 'stay.write' }, async (ctx) => {
  const s = D.getScoped(db.stays, ctx.params.id, ctx);
  const b = clean(ctx.body, { status: { t: 'e', values: ['checked_in', 'checked_out', 'cancelled'], req: true } });
  const ok = { booked: ['checked_in', 'cancelled'], checked_in: ['checked_out', 'cancelled'], checked_out: [], cancelled: [] }[s.status];
  if (!ok.includes(b.status)) throw E.conflict(`A booking that is ${s.status.replace('_', ' ')} cannot become ${b.status.replace('_', ' ')}.`);
  const up = db.stays.update(s.id, { status: b.status, [b.status + 'At']: Date.now() });
  D.audit(ctx, 'stay.' + b.status, 'stay', s.id, {});
  return { stay: stayView(up) };
});

/* ====================================================================================== */
/* PROJECTS (development / renovation)                                                    */
/* ====================================================================================== */
const PROJ_F = { name: { t: 's', req: true, min: 3, max: 120 }, kind: { t: 'e', values: ['new_build', 'renovation', 'extension', 'fit_out', 'land_development', 'other'], req: true }, propertyId: { t: 'id' }, location: { t: 's', max: 120 }, budget: { t: 'n', req: true, min: 1, max: 1e11 }, startDate: { t: 'd' }, endDate: { t: 'd' }, status: { t: 'e', values: ['planning', 'active', 'on_hold', 'completed', 'cancelled'], def: 'planning' }, contractorName: { t: 's', max: 100 }, notes: { t: 's', max: 600 } };
const projView = (p) => {
  const ms = p.milestones || []; const spent = r2((p.costs || []).reduce((a, c) => a + c.amount, 0));
  return { ...p, propertyName: p.propertyId ? propName(p.propertyId) : '', spent, remaining: r2(p.budget - spent), overBudget: spent > p.budget, progress: ms.length ? Math.round((ms.filter((m) => m.done).length / ms.length) * 100) : 0 };
};
H.route('GET', '/api/projects', { perm: 'project.read' }, async (ctx) => ({ projects: D.orgList(db.projects, ctx).sort((a, b) => b.updatedAt - a.updatedAt).map(projView) }));
H.route('POST', '/api/projects', { perm: 'project.write', rate: [100, 3600000] }, async (ctx) => {
  const b = clean(ctx.body, PROJ_F);
  if (b.startDate && b.endDate && b.endDate < b.startDate) throw E.bad('The end date is before the start date');
  const p = db.projects.insert({ ...b, ownerId: ctx.scope.ownerId, propertyId: checkProp(ctx, b.propertyId), milestones: [], costs: [], createdBy: ctx.user.id });
  D.audit(ctx, 'project.created', 'project', p.id, { name: p.name, budget: p.budget });
  return { project: projView(p) };
});
H.route('PUT', '/api/projects/:id', { perm: 'project.write' }, async (ctx) => {
  const p = D.orgGet(db.projects, ctx.params.id, ctx);
  const f = Object.fromEntries(Object.entries(PROJ_F).map(([k, v]) => [k, { ...v, req: false, def: undefined }]));
  const { version, ...patch } = clean(ctx.body, { ...f, version: { t: 'n', int: true } });
  if (patch.propertyId) patch.propertyId = checkProp(ctx, patch.propertyId);
  return { project: projView(db.projects.update(p.id, patch, version)) };
});
H.route('DELETE', '/api/projects/:id', { perm: 'project.write' }, async (ctx) => {
  const p = D.orgGet(db.projects, ctx.params.id, ctx);
  if ((p.costs || []).length) throw E.conflict('This project has recorded costs and is kept for your records. Mark it as cancelled instead.');
  db.projects.remove(p.id); D.audit(ctx, 'project.deleted', 'project', p.id, { name: p.name }); return { ok: true };
});
H.route('POST', '/api/projects/:id/milestones', { perm: 'project.write' }, async (ctx) => {
  const p = D.orgGet(db.projects, ctx.params.id, ctx);
  const b = clean(ctx.body, { title: { t: 's', req: true, max: 120 }, due: { t: 'd' } });
  if ((p.milestones || []).length >= 100) throw E.conflict('A project can have up to 100 milestones.');
  return { project: projView(db.projects.update(p.id, (x) => { x.milestones = [...(x.milestones || []), { id: U.newId('mls'), title: b.title, due: b.due || null, done: false }]; return x; })) };
});
H.route('POST', '/api/projects/:id/milestones/:mid/toggle', { perm: 'project.write' }, async (ctx) => {
  const p = D.orgGet(db.projects, ctx.params.id, ctx);
  if (!(p.milestones || []).some((m) => m.id === ctx.params.mid)) throw E.notFound();
  return { project: projView(db.projects.update(p.id, (x) => { x.milestones = x.milestones.map((m) => (m.id === ctx.params.mid ? { ...m, done: !m.done, doneAt: !m.done ? Date.now() : null } : m)); return x; })) };
});
H.route('POST', '/api/projects/:id/costs', { perm: 'project.write', rate: [300, 3600000] }, async (ctx) => {
  const p = D.orgGet(db.projects, ctx.params.id, ctx);
  const b = clean(ctx.body, { description: { t: 's', req: true, max: 160 }, amount: { t: 'n', req: true, min: 1, max: 1e10 }, date: { t: 'd', req: true }, vendor: { t: 's', max: 100 }, category: { t: 'e', values: ['materials', 'labour', 'permits', 'professional_fees', 'equipment', 'other'], def: 'materials' } });
  if ((p.costs || []).length >= 1000) throw E.conflict('Too many cost lines on one project.');
  const up = db.projects.update(p.id, (x) => { x.costs = [...(x.costs || []), { id: U.newId('cst'), ...b, by: ctx.user.id }]; return x; });
  D.audit(ctx, 'project.cost_added', 'project', p.id, { amount: b.amount });
  return { project: projView(up) };
});
H.route('DELETE', '/api/projects/:id/costs/:cid', { perm: 'project.write' }, async (ctx) => {
  const p = D.orgGet(db.projects, ctx.params.id, ctx);
  if (!(p.costs || []).some((c) => c.id === ctx.params.cid)) throw E.notFound();
  const up = db.projects.update(p.id, (x) => { x.costs = x.costs.filter((c) => c.id !== ctx.params.cid); return x; });
  D.audit(ctx, 'project.cost_removed', 'project', p.id, {}); return { project: projView(up) };
});

/* ====================================================================================== */
/* ASSETS (lifts, generators, boreholes ...) with service reminders                       */
/* ====================================================================================== */
const ASSET_F = { propertyId: { t: 'id', req: true }, name: { t: 's', req: true, min: 2, max: 100 }, category: { t: 'e', values: ASSET_CATS, req: true }, location: { t: 's', max: 100 }, serial: { t: 's', max: 60 }, supplier: { t: 's', max: 100 }, installDate: { t: 'd' }, warrantyUntil: { t: 'd' }, serviceEveryMonths: { t: 'n', int: true, max: 60, def: 0 }, lastService: { t: 'd' }, value: { t: 'n', max: 1e10 }, status: { t: 'e', values: ['working', 'needs_repair', 'out_of_service'], def: 'working' }, notes: { t: 's', max: 300 } };
const nextOf = (a) => (a.serviceEveryMonths > 0 && (a.lastService || a.installDate) ? addMonths(a.lastService || a.installDate, a.serviceEveryMonths) : null);
const assetView = (a) => { const today = U.todayStr(); const nx = a.nextService || null; return { ...a, propertyName: propName(a.propertyId), dueIn: nx ? U.daysBetween(today, nx) : null, serviceState: !nx ? 'none' : nx < today ? 'overdue' : U.daysBetween(today, nx) <= 30 ? 'soon' : 'ok', inWarranty: !!(a.warrantyUntil && a.warrantyUntil >= today) }; };
H.route('GET', '/api/assets', { perm: 'asset.read' }, async (ctx) => ({ assets: D.listScoped(db.assets, ctx).sort((a, b) => (a.nextService || '9999').localeCompare(b.nextService || '9999')).map(assetView), categories: ASSET_CATS }));
H.route('POST', '/api/assets', { perm: 'asset.write', rate: [200, 3600000] }, async (ctx) => {
  const b = clean(ctx.body, ASSET_F); const p = D.getProperty(b.propertyId, ctx);
  const a = db.assets.insert({ ...b, ownerId: p.ownerId, history: [], createdBy: ctx.user.id }); const nx = nextOf(a);
  const up = nx ? db.assets.update(a.id, { nextService: nx }) : a;
  D.audit(ctx, 'asset.created', 'asset', a.id, { name: a.name }); return { asset: assetView(up) };
});
H.route('PUT', '/api/assets/:id', { perm: 'asset.write' }, async (ctx) => {
  const a = D.getScoped(db.assets, ctx.params.id, ctx);
  const { propertyId, ...f } = ASSET_F;
  const { version, ...patch } = clean(ctx.body, { ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, { ...v, req: false, def: undefined }])), version: { t: 'n', int: true } });
  const m = { ...a, ...patch }; patch.nextService = nextOf(m);
  return { asset: assetView(db.assets.update(a.id, patch, version)) };
});
H.route('POST', '/api/assets/:id/service', { perm: 'asset.write', rate: [200, 3600000] }, async (ctx) => {
  const a = D.getScoped(db.assets, ctx.params.id, ctx);
  const b = clean(ctx.body, { date: { t: 'd', req: true }, cost: { t: 'n', max: 1e9, def: 0 }, vendor: { t: 's', max: 100 }, note: { t: 's', max: 300 }, recordExpense: { t: 'b' } });
  if (b.date > U.todayStr()) throw E.bad('The service date cannot be in the future');
  const m = { ...a, lastService: b.date };
  const up = db.assets.update(a.id, (x) => { x.lastService = b.date; x.nextService = nextOf(m); x.status = 'working'; x.history = [...(x.history || []), { id: U.newId('svc'), date: b.date, cost: b.cost || 0, vendor: b.vendor || '', note: b.note || '', by: ctx.user.id }].slice(-100); return x; });
  if (b.recordExpense && b.cost > 0 && R.can(ctx.user, 'expense.write')) db.expenses.insert({ ownerId: a.ownerId, propertyId: a.propertyId, category: 'Repairs & maintenance', amount: b.cost, date: b.date, description: `Service: ${a.name}`.slice(0, 200), vendor: b.vendor || '', createdBy: ctx.user.id });
  D.audit(ctx, 'asset.serviced', 'asset', a.id, { cost: b.cost || 0 }); return { asset: assetView(up) };
});
H.route('DELETE', '/api/assets/:id', { perm: 'asset.write' }, async (ctx) => {
  const a = D.getScoped(db.assets, ctx.params.id, ctx); db.assets.remove(a.id); D.audit(ctx, 'asset.deleted', 'asset', a.id, { name: a.name }); return { ok: true };
});

/* ====================================================================================== */
/* COMPLIANCE (insurance, permits, licences, certificates)                                */
/* ====================================================================================== */
const CMP_F = { propertyId: { t: 'id' }, kind: { t: 'e', values: COMPLIANCE_KINDS, req: true }, title: { t: 's', req: true, min: 2, max: 120 }, refNo: { t: 's', max: 60 }, issuer: { t: 's', max: 100 }, issued: { t: 'd' }, expires: { t: 'd', req: true, label: 'Expiry date' }, cost: { t: 'n', max: 1e9 }, notes: { t: 's', max: 300 } };
const cmpView = (c) => { const today = U.todayStr(); const left = U.daysBetween(today, c.expires); return { ...c, propertyName: c.propertyId ? propName(c.propertyId) : 'All properties', daysLeft: left, state: left < 0 ? 'expired' : left <= 30 ? 'expiring' : 'valid' }; };
H.route('GET', '/api/compliance', { perm: 'compliance.read' }, async (ctx) => {
  const rows = D.orgList(db.compliance, ctx).sort((a, b) => a.expires.localeCompare(b.expires));
  return { items: rows.map(cmpView), kinds: COMPLIANCE_KINDS };
});
H.route('POST', '/api/compliance', { perm: 'compliance.write', rate: [200, 3600000] }, async (ctx) => {
  const b = clean(ctx.body, CMP_F);
  if (!ctx.scope.all && !b.propertyId) throw E.bad('Choose a property');
  const c = db.compliance.insert({ ...b, ownerId: ctx.scope.ownerId, propertyId: checkProp(ctx, b.propertyId), createdBy: ctx.user.id });
  D.audit(ctx, 'compliance.created', 'compliance', c.id, { kind: c.kind, expires: c.expires }); return { item: cmpView(c) };
});
H.route('PUT', '/api/compliance/:id', { perm: 'compliance.write' }, async (ctx) => {
  const c = D.orgGet(db.compliance, ctx.params.id, ctx);
  const f = Object.fromEntries(Object.entries(CMP_F).map(([k, v]) => [k, { ...v, req: false }]));
  const { version, ...patch } = clean(ctx.body, { ...f, version: { t: 'n', int: true } });
  if (patch.propertyId) patch.propertyId = checkProp(ctx, patch.propertyId);
  if (patch.expires && patch.expires !== c.expires) patch.noticed = null;
  return { item: cmpView(db.compliance.update(c.id, patch, version)) };
});
H.route('DELETE', '/api/compliance/:id', { perm: 'compliance.write' }, async (ctx) => {
  if (!ctx.scope.all) throw E.forbidden('Only the landlord can delete a compliance record.');
  const c = D.orgGet(db.compliance, ctx.params.id, ctx); db.compliance.remove(c.id); D.audit(ctx, 'compliance.deleted', 'compliance', c.id, { kind: c.kind }); return { ok: true };
});

/* ====================================================================================== */
/* ECOSYSTEM OVERVIEW for the signed-in organisation                                      */
/* ====================================================================================== */
H.route('GET', '/api/ecosystem/summary', { roles: ['landlord', 'property_manager', 'caretaker'] }, async (ctx) => {
  const out = {}; const can = (p) => R.can(ctx.user, p); const today = U.todayStr();
  if (can('sales.read')) { const s = D.orgList(db.sales, ctx); out.sales = { active: s.filter((x) => x.status === 'active').length, underOffer: s.filter((x) => x.status === 'under_offer').length, sold: s.filter((x) => x.status === 'sold').length, awaitingVerification: s.filter((x) => x.status === 'active' && !x.verified).length, listedValue: r2(s.filter((x) => ['active', 'under_offer'].includes(x.status)).reduce((a, x) => a + x.price, 0)) }; }
  if (can('lead.read')) { const l = D.orgList(db.leads, ctx); const d = D.orgList(db.deals, ctx); out.leads = { total: l.length, new: l.filter((x) => x.stage === 'new').length, followUpsDue: l.filter((x) => !['won', 'lost'].includes(x.stage) && x.nextFollowUp && x.nextFollowUp <= today).length, openDeals: d.filter((x) => x.status === 'open').length, pipelineValue: r2(d.filter((x) => x.status === 'open').reduce((a, x) => a + x.price, 0)), commissionEarned: r2(d.filter((x) => x.status === 'closed').reduce((a, x) => a + commission(x), 0)) }; }
  if (can('stay.read')) { const st = D.listScoped(db.stays, ctx).filter((x) => x.status !== 'cancelled'); out.stays = { upcoming: st.filter((x) => x.status === 'booked' && x.checkIn >= today).length, inHouse: st.filter((x) => x.status === 'checked_in').length, arrivalsToday: st.filter((x) => x.status === 'booked' && x.checkIn === today).length, revenue: r2(st.reduce((a, x) => a + x.total, 0)) }; }
  if (can('project.read')) { const p = D.orgList(db.projects, ctx).filter((x) => ['planning', 'active', 'on_hold'].includes(x.status)).map(projView); out.projects = { open: p.length, budget: r2(p.reduce((a, x) => a + x.budget, 0)), spent: r2(p.reduce((a, x) => a + x.spent, 0)), overBudget: p.filter((x) => x.overBudget).length }; }
  if (can('asset.read')) { const a = D.listScoped(db.assets, ctx).map(assetView); out.assets = { total: a.length, overdue: a.filter((x) => x.serviceState === 'overdue').length, dueSoon: a.filter((x) => x.serviceState === 'soon').length, needRepair: a.filter((x) => x.status !== 'working').length }; }
  if (can('compliance.read')) { const c = D.orgList(db.compliance, ctx).map(cmpView); out.compliance = { total: c.length, expired: c.filter((x) => x.state === 'expired').length, expiring: c.filter((x) => x.state === 'expiring').length }; }
  return out;
});

/* ====================================================================================== */
/* SERVICES MARKETPLACE                                                                   */
/* ====================================================================================== */
const provView = (p) => ({ id: p.id, name: p.name, category: p.category, county: p.county, town: p.town || '', description: p.description || '', phone: p.phone, website: p.website || '', licenceNo: p.licenceNo || '', featured: !!p.featured, since: p.approvedAt || p.createdAt });
const PQ = { category: { t: 'e', values: PROVIDER_CATEGORIES }, county: { t: 's', max: 40 }, q: { t: 's', max: 60 } };
H.route('GET', '/api/public/providers', { public: true, rate: [60, 60000] }, async (ctx) => {
  const q = clean(ctx.query, PQ); let rows = db.providers.where('status', 'approved');
  if (q.category) rows = rows.filter((p) => p.category === q.category);
  if (q.county) rows = rows.filter((p) => p.county.toLowerCase() === q.county.toLowerCase());
  if (q.q) { const t = q.q.toLowerCase(); rows = rows.filter((p) => `${p.name} ${p.town || ''} ${p.description || ''}`.toLowerCase().includes(t)); }
  rows.sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0) || a.name.localeCompare(b.name));
  return { providers: rows.slice(0, 200).map(provView), categories: PROVIDER_CATEGORIES };
});
H.route('POST', '/api/public/providers/apply', { public: true, rate: [4, 3600000] }, async (ctx) => {
  const b = clean(ctx.body, { name: { t: 's', req: true, min: 2, max: 100, label: 'Business name' }, contactName: { t: 's', req: true, max: 80, label: 'Contact person' }, category: { t: 'e', values: PROVIDER_CATEGORIES, req: true }, county: { t: 's', req: true, max: 40 }, town: { t: 's', max: 60 }, phone: { t: 'phone', req: true }, email: { t: 'email' }, website: { t: 's', max: 150, re: /^https?:\/\/[^\s]+$/ }, licenceNo: { t: 's', max: 60, label: 'Licence / registration number' }, description: { t: 's', max: 500 }, consent: { t: 'b' }, website2: { t: 's', max: 50 } });
  if (b.website2) return { ok: true };
  if (!b.consent) throw E.bad('Please tick the box to confirm that your business details may be shown publicly if approved, and that you accept the Terms and Privacy Notice.');
  if (db.providers.where('phone', b.phone).length) throw E.conflict('A business with that phone number has already applied.');
  const { consent, website2, ...f } = b;
  const p = db.providers.insert({ ...f, status: 'pending', featured: false, consent: { at: Date.now(), legalVersion: require('../legal').VERSION, ip: ctx.ip } });
  db.consents.insert({ subject: b.phone, purpose: 'provider_listing', legalVersion: require('../legal').VERSION, refId: p.id, ip: ctx.ip });
  for (const a of db.users.where('role', 'national_admin')) D.notify(a.id, 'Service provider waiting for approval', `${p.name} (${p.category.replace(/_/g, ' ')}, ${p.county})`, 'admin', '#/admin/marketplace');
  return { ok: true, message: 'Thank you! National Administration will review your application and may call you to check your licence.' };
});
H.route('POST', '/api/public/providers/:id/request', { public: true, rate: [6, 600000] }, async (ctx) => {
  const b = clean(ctx.body, { name: { t: 's', req: true, min: 2, max: 80 }, phone: { t: 'phone', req: true }, message: { t: 's', req: true, max: 400, label: 'Message' }, consent: { t: 'b' }, website: { t: 's', max: 50 } });
  if (b.website) return { ok: true };
  if (!b.consent) throw E.bad('Please tick the box to allow this provider to contact you about your request.');
  const p = db.providers.get(ctx.params.id); if (!p || p.status !== 'approved') throw E.notFound('This provider is not available');
  const r = db.service_requests.insert({ providerId: p.id, name: b.name, phone: b.phone, message: b.message, status: 'new', consent: { at: Date.now(), ip: ctx.ip } });
  db.consents.insert({ subject: b.phone, purpose: 'service_request', legalVersion: require('../legal').VERSION, refId: r.id, ip: ctx.ip });
  return { ok: true, message: `Request sent. ${p.name} can also be called on ${p.phone}.` };
});
H.route('GET', '/api/admin/providers', { perm: 'platform.providers' }, async (ctx) => {
  const st = ctx.query.status; let rows = db.providers.all(); if (st) rows = rows.filter((p) => p.status === st);
  return { providers: rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, 300).map((p) => ({ ...provView(p), status: p.status, contactName: p.contactName, email: p.email || '', note: p.reviewNote || '', requests: db.service_requests.where('providerId', p.id).length, createdAt: p.createdAt })) };
});
H.route('POST', '/api/admin/providers/:id/review', { perm: 'platform.providers', rate: [120, 60000] }, async (ctx) => {
  const b = clean(ctx.body, { status: { t: 'e', values: ['approved', 'rejected', 'suspended'], req: true }, featured: { t: 'b' }, note: { t: 's', max: 200 } });
  const p = db.providers.get(ctx.params.id); if (!p) throw E.notFound();
  const up = db.providers.update(p.id, { status: b.status, featured: b.status === 'approved' && !!b.featured, reviewNote: b.note || '', approvedAt: b.status === 'approved' ? (p.approvedAt || Date.now()) : p.approvedAt, reviewedBy: ctx.user.id });
  S.audit.append({ actor: ctx.user.id, role: ctx.user.role, action: 'provider.' + b.status, entity: 'provider', entityId: p.id, ip: ctx.ip, detail: { name: p.name } });
  return { provider: { id: up.id, status: up.status } };
});
H.route('GET', '/api/admin/service-requests', { perm: 'platform.providers' }, async () => ({ requests: db.service_requests.all().sort((a, b) => b.createdAt - a.createdAt).slice(0, 200).map((r) => ({ id: r.id, providerName: (db.providers.get(r.providerId) || {}).name || '', name: r.name, phone: r.phone, message: r.message, status: r.status, createdAt: r.createdAt })) }));
H.route('GET', '/api/admin/marketplace', { perm: 'platform.providers' }, async () => {
  const pr = db.providers.all(); const sa = db.sales.all(); const today = U.todayStr();
  return { providers: { pending: pr.filter((p) => p.status === 'pending').length, approved: pr.filter((p) => p.status === 'approved').length, suspended: pr.filter((p) => p.status === 'suspended').length }, requestsThisMonth: db.service_requests.all().filter((r) => U.dateOf(r.createdAt).slice(0, 7) === today.slice(0, 7)).length, sales: { awaiting: sa.filter((s) => s.status === 'active' && !s.verified).length, public: sa.filter(isPublicSale).length, sold: sa.filter((s) => s.status === 'sold').length }, categories: PROVIDER_CATEGORIES };
});

module.exports = { isPublicSale, saleView, publicSales, KINDS, PROVIDER_CATEGORIES, assetView, cmpView };
