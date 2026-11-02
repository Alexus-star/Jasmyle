# Jasmyle Properties roadmap and recommendations

## What Jasmyle Properties does that a listings-only app does not
Listing apps (Crib Hunter and similar) help a tenant *find* a house. Jasmyle Properties also runs the house afterwards: rent collection by M-Pesa/PayPal/bank with receipts, arrears alerts, maintenance, leases, inspections, KRA tax summaries and eTIMS queue, role firewalls between landlords and staff, platform billing, and a rental passport that follows the tenant.

## Built (this release)
Photo and video galleries per house (cover photo, floor plan, auto-shrunk photos, Range streaming for video) - virtual-tour links (YouTube, Vimeo, Matterport, Kuula) - viewing bookings with SMS confirmation and no-show tracking - saved searches that text you when a match is listed - favourites and compare (on the visitor's phone) - WhatsApp share - rental passport - OpenAPI reference (`/docs.html`) - unit, smoke and browser tests with CI.

## Added in v6
Water and electricity meter readings with per-property rates and automatic tenant bills (caretakers record, landlord/manager bills). CSV import of units and tenants with preview, row-level errors and no back-billing of old months.

## Recommended next (not built - honest list)
| Feature | Why it is not in yet |
|---|---|
| Paid, escrowed viewing fees (like Crib Tours) | Holding client money makes you a payment aggregator; needs a CBK licence or a licensed partner |
| Map with pins and "near me" | Needs a map provider key and lat/lng on each property (today it links out to Google Maps) |
| Agent directory with reviews | Needs moderation rules against fake reviews |
| WhatsApp Business notifications | Needs a Meta-approved business account and templates |
| Offline mode / installable app (PWA) | Service worker deliberately left out until cache rules for private data are reviewed |
| KRA PIN checker (GavaConnect) | Needs KRA API credentials |
| Tenant screening / CRB checks | CRB access is licensed |
| E-signature on leases | Legal review of acceptable signature type |
| Video compression on upload | Done for photos only; large videos limited to 40 MB |

## Quality
`npm run test:all` runs unit, API/smoke and browser tests. Live M-Pesa, PayPal and KRA calls are only testable with your own credentials and are exercised here in practice mode.

## Ideas for later
Utility history on the tenant's own screen, sub-metered utilities split by occupants, M-Pesa statement (CSV) upload to match payments automatically, SMS reminders when meter sheets are unfinished.


## Added in v7 (Jasmyle Properties)
Sales and land listings with verification, lead pipeline and deals, short stays, projects, assets register, compliance tracker, services directory, global search, CSV exports, Terms/Privacy/About with consent records, Privacy centre and data-subject requests, retention jobs, server metrics and compression.

Still deliberately not built: mortgage/credit applications, escrow of purchase money (licensed partner needed), provider reviews (moderation needed), online land-registry search (needs Ardhisasa access), e-signatures (legal review), tenant screening/CRB.
