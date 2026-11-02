'use strict';
// ROLES & PERMISSIONS - the single source of truth for "who can do what".
// The API enforces this table on every request (deny by default), and the app
// shows it to users on the "Roles & Permissions" page.

const PERMS = {
  // platform (National Administration)
  'platform.stats': 'View national statistics (aggregate, anonymised)',
  'platform.landlords': 'Create, approve, suspend and verify landlord accounts',
  'platform.properties': 'Verify or suspend property listings',
  'platform.audit': 'View the platform audit trail',
  'platform.admins': 'Manage other National Administrators (super administrator only)',
  'platform.settings': 'Platform settings, announcements, registration rules, backups and security checks',
  'platform.finance': 'See platform revenue, set the fee per unit, waive or confirm landlord fees (changing prices and payout details: super administrator only)',
  'platform.rules': 'View integration health and tax rules (changing them: super administrator only)',
  'billing.read': 'See and pay the platform fee for the units you manage on the system',
  'tax.read': 'View Kenya tax summaries (rental income tax, VAT) and eTIMS status', 'tax.write': 'Change tax profile, property usage and eTIMS settings',
  // organisation data
  'property.read': 'View properties', 'property.create': 'Add new properties', 'property.update': 'Edit all property details',
  'property.update.basic': 'Edit property description and amenities', 'property.archive': 'Archive a property',
  'unit.read': 'View units', 'unit.write': 'Add and edit units (rent, listing status)',
  'tenant.read': 'View tenant details', 'tenant.read.basic': 'View tenant name, unit and phone only', 'tenant.write': 'Add and edit tenants',
  'lease.read': 'View leases', 'lease.write': 'Create leases and move tenants in', 'lease.rent': 'Change rent and deposit amounts',
  'lease.terminate': 'End a lease / move tenant out', 'lease.document': 'Upload and open lease agreements',
  'rent.read': 'View invoices, payments and arrears', 'rent.pay': 'Pay own rent online', 'rent.collect': 'Record or confirm payments (cash, bank, M-Pesa)',
  'rent.charge': 'Add extra charges (water, garbage, penalties)', 'utility.read': 'Record water and electricity meter readings and see consumption',
  'rent.void': 'Void invoices and reverse payments',
  'expense.read': 'View expenses', 'expense.write': 'Record and edit expenses', 'expense.delete': 'Delete expenses',
  'maintenance.report': 'Report maintenance problems (photos / videos)', 'maintenance.read': 'View maintenance requests',
  'maintenance.approve': 'Approve or reject maintenance (within spending limit)', 'maintenance.assign': 'Assign jobs to contractors / maintenance teams',
  'maintenance.update': 'Update job progress and cost', 'maintenance.rate': 'Rate completed jobs',
  'inspection.read': 'View inspections', 'inspection.write': 'Carry out inspections with digital checklists',
  'contractor.read': 'View contractors', 'contractor.write': 'Add and edit contractors',
  'report.finance': 'Financial reports', 'report.vacancy': 'Vacancy reports', 'report.contractors': 'Contractor performance reports',
  'staff.manage': 'Create staff accounts and assign them to properties', 'settings.payments': 'Payment, SMS and bank settings',
  'sales.read': 'View properties and land for sale', 'sales.write': 'List, edit and withdraw properties and land for sale',
  'lead.read': 'View buyer / tenant / seller leads (sales pipeline)', 'lead.write': 'Add leads, move them through the pipeline, log notes, record deals and commission',
  'stay.read': 'View short-stay / holiday-let bookings', 'stay.write': 'Create, check in/out and cancel short-stay bookings',
  'project.read': 'View development and renovation projects', 'project.write': 'Create projects, milestones and project costs',
  'asset.read': 'View the building assets register (lifts, generators, boreholes...)', 'asset.write': 'Add assets and record servicing',
  'compliance.read': 'View licences, permits and insurance expiry dates', 'compliance.write': 'Add and renew licences, permits and insurance records',
  'platform.providers': 'Approve or suspend service providers, verify sale listings and see marketplace activity',
  'platform.privacy': 'Handle data-subject requests and edit the data-controller details used in the legal pages',
  'audit.read': 'View the organisation audit trail', 'chat.use': 'Send and receive messages', 'inquiry.read': 'View enquiries from people looking for a house',
};

const P = (s) => s.split(/\s+/).filter(Boolean);

const ROLES = {
  national_admin: {
    label: 'National Administrator',
    short: 'National Admin',
    blurb: 'Oversees the whole platform. Sees only aggregate and account-level information - never tenants\' money, leases or private messages.',
    perms: P('platform.stats platform.landlords platform.properties platform.audit platform.settings platform.admins platform.finance platform.rules platform.providers platform.privacy'),
    can: [
      'See national statistics: landlords, properties, units, occupancy, totals by county',
      'Create, approve, suspend and re-activate landlord accounts',
      'Verify property ownership so a property can appear in public search',
      'Suspend a fraudulent or non-compliant listing',
      'Reset a landlord\'s password and 2FA after identity checks',
      'Read the tamper-proof platform audit trail and run integrity checks',
      'Create database backups, set the public web address',
      'See platform revenue and set the monthly fee per unit managed, with free units, tiers and per-landlord discounts',
      'Keep tax rates and M-Pesa / PayPal / KRA endpoints up to date through signed rules packs',
      'Post announcements, open or close landlord registration, put the system in maintenance mode',
      'Approve service providers (movers, valuers, surveyors, lawyers, cleaners...) and verify properties for sale before they go public',
      'Handle data-protection requests from users and keep the data-controller details in the legal pages up to date',
      'Super administrator only: add or disable other National Administrators, change prices and payout accounts',
    ],
    cannot: [
      'View, edit or delete any tenant, lease, invoice, payment, expense or chat message',
      'Open lease agreements or maintenance photos',
      'Change landlord payment settings or move money',
      'Act as a landlord, manager or tenant',
    ],
    scope: 'Whole platform - account level and aggregates only',
  },
  landlord: {
    label: 'Landlord / Owner',
    short: 'Landlord',
    blurb: 'Owns an organisation. Full control of everything inside their own properties, and nothing outside them.',
    perms: P(`property.read property.create property.update property.archive unit.read unit.write tenant.read tenant.write lease.read lease.write
      lease.rent lease.terminate lease.document rent.read rent.collect rent.charge rent.void utility.read expense.read expense.write expense.delete
      maintenance.read maintenance.approve maintenance.assign maintenance.update maintenance.rate maintenance.report inspection.read inspection.write contractor.read contractor.write
      report.finance report.vacancy report.contractors staff.manage settings.payments audit.read chat.use inquiry.read billing.read tax.read tax.write
      sales.read sales.write lead.read lead.write stay.read stay.write project.read project.write asset.read asset.write compliance.read compliance.write`),
    can: [
      'Add unlimited properties and units; list vacant units for public search',
      'Collect rent through M-Pesa, PayPal/card and bank; record cash',
      'Create staff accounts and choose exactly which properties each can access',
      'Set each manager\'s maintenance approval limit',
      'Approve maintenance of any amount; track income and expenses; all reports',
      'Store lease agreements securely (encrypted); change rent and deposits',
      'Void invoices and reverse payments (always logged)',
      'Configure payment gateways and SMS; read the organisation audit trail',
      'See the monthly platform fee and pay it by M-Pesa, PayPal/card or bank',
      'Set the KRA tax profile, mark properties residential or commercial, see rental income tax and VAT summaries, send eTIMS invoices',
      'List houses, plots and commercial space for sale; run a buyer/tenant lead pipeline and record deals and commission',
      'Run short-stay / holiday-let bookings, development and renovation projects, a building-assets register with service reminders, and licence / insurance expiry tracking',
    ],
    cannot: [
      'See anything belonging to another landlord',
      'Change National Administration settings or verify own properties',
    ],
    scope: 'Own organisation (all properties)',
  },
  property_manager: {
    label: 'Property Manager (Agent)',
    short: 'Manager',
    blurb: 'Runs day-to-day operations for the properties the landlord assigns - and only those.',
    perms: P(`property.read property.update.basic unit.read unit.write tenant.read tenant.write lease.read lease.write lease.terminate lease.document
      rent.read rent.collect rent.charge utility.read expense.read expense.write maintenance.read maintenance.approve maintenance.assign maintenance.update maintenance.rate maintenance.report tax.read
      inspection.read inspection.write contractor.read contractor.write report.finance report.vacancy report.contractors chat.use inquiry.read
      sales.read sales.write lead.read lead.write stay.read stay.write asset.read asset.write compliance.read`),
    can: [
      'Manage units, tenants and leases of assigned properties',
      'Collect and confirm rent; record cash and bank payments; add charges',
      'Record meter readings and bill water / electricity to tenants (rates are set by the landlord)',
      'Approve maintenance up to the limit set by the landlord; assign contractors',
      'Run inspections with digital checklists; track repairs and contractor performance',
      'Generate monthly financial and vacancy reports for assigned properties',
      'Chat with tenants and caretakers of assigned properties',
      'Act as the sales agent: list properties for sale, work the lead pipeline, record deals and commission, manage short-stay bookings and the assets register',
    ],
    cannot: [
      'See or touch properties that are not assigned to them (including another agent\'s properties)',
      'Add or archive properties, change rent/deposit amounts, void invoices or reverse payments',
      'Create staff, change payment settings, read the audit trail or delete expenses',
      'Approve maintenance above their approval limit',
    ],
    scope: 'Only the properties assigned by the landlord',
  },
  caretaker: {
    label: 'Caretaker',
    short: 'Caretaker',
    blurb: 'On-site person. Handles inspections and day-to-day repairs - no access to money.',
    perms: P('property.read unit.read tenant.read.basic utility.read maintenance.report maintenance.read maintenance.update inspection.read inspection.write contractor.read chat.use asset.read'),
    can: [
      'See assigned properties, units and tenant names/phones',
      'Carry out inspections; report problems on behalf of tenants',
      'Record water and electricity meter readings (the landlord or manager issues the bills)',
      'Update progress of maintenance jobs on assigned properties',
      'Chat with tenants and managers',
    ],
    cannot: [
      'See rent, payments, expenses, leases or reports',
      'Approve spending, assign contractors or change any property/unit/tenant details',
    ],
    scope: 'Only the properties assigned by the landlord',
  },
  contractor: {
    label: 'Maintenance Team / Contractor',
    short: 'Contractor',
    blurb: 'External technician or team. Sees only the jobs assigned to them.',
    perms: P('maintenance.read maintenance.update'),
    can: ['See only jobs assigned to them', 'Update status, add quotation / final cost, notes and photos'],
    cannot: ['See other jobs, tenants\' personal data, money, leases or any other part of the system'],
    scope: 'Only maintenance jobs assigned to them',
  },
  tenant: {
    label: 'Tenant',
    short: 'Tenant',
    blurb: 'Rents a unit. Sees only their own lease, rent and requests.',
    perms: P('rent.pay maintenance.report maintenance.read maintenance.rate lease.read lease.document chat.use'),
    can: [
      'Pay rent via M-Pesa, PayPal/card or bank and get instant receipts',
      'Report maintenance problems with photos or videos and follow progress',
      'Chat with the landlord / property manager',
      'See reminders and the full digital record of rent and rental history',
      'Search verified rental properties',
    ],
    cannot: ['See any other tenant, unit or property data', 'Change rent, invoices or lease terms'],
    scope: 'Own lease(s) only',
  },
};

const ORG_STAFF = ['property_manager', 'caretaker', 'contractor'];

function can(user, perm) {
  const r = ROLES[user && user.role];
  return !!r && r.perms.includes(perm);
}
function canAny(user, perms) { return perms.some((p) => can(user, p)); }

/** Data scope for a signed-in user. Every query is filtered through this. */
function scopeOf(user) {
  switch (user.role) {
    case 'landlord': return { kind: 'org', ownerId: user.id, all: true, props: null };
    case 'property_manager':
    case 'caretaker': return { kind: 'org', ownerId: user.ownerId, all: false, props: new Set(user.assignedPropertyIds || []) };
    case 'contractor': return { kind: 'jobs', ownerId: user.ownerId, contractorId: user.contractorId || null };
    case 'tenant': return { kind: 'self', tenantId: user.id, ownerId: user.ownerId };
    default: return { kind: 'none' };
  }
}
/** record has ownerId (+ propertyId) / tenantId fields */
function inScope(scope, rec) {
  if (!rec) return false;
  if (scope.kind === 'org') return rec.ownerId === scope.ownerId && (scope.all || (!!rec.propertyId && scope.props.has(rec.propertyId)));
  if (scope.kind === 'self') return rec.tenantId === scope.tenantId;
  return false;
}
/** for property records themselves (the record id is the property id) */
function propInScope(scope, prop) {
  if (!prop || scope.kind !== 'org') return false;
  return prop.ownerId === scope.ownerId && (scope.all || scope.props.has(prop.id));
}

module.exports = { PERMS, ROLES, ORG_STAFF, can, canAny, scopeOf, inScope, propInScope };
