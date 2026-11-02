# Jasmyle Properties – the complete real-estate platform

Self-hosted on your laptop or any cloud server. Rentals, sales and land, short stays, projects, assets, licences, a services directory and full Kenyan data-protection tooling in one system. Landlords, property managers, caretakers, contractors and tenants each get their own view. Blue and red interface, works on phones and computers.

## 1. Install (about 5 minutes)

**Windows, simplest way (recommended to start): extract the WHOLE zip (right-click > Extract All), open the folder, double-click `START-HERE-windows.bat`.** It checks Node.js (installs it if missing), starts Jasmyle Properties and opens your browser. Keep the black window open while you use it. Nothing is installed, no administrator rights needed. If anything goes wrong, double-click `diagnose-windows.bat` and send the file it creates; it tests the whole system on your computer and records the exact problem.

**Windows, always-on (starts by itself when the laptop switches on):** unzip the WHOLE folder (do not run it from inside the zip), double-click `install-windows.bat`, and accept the Administrator prompt. When it finishes, your browser opens `http://localhost:8080`.
**Linux:** unzip, then `sudo bash install-linux.sh`.

The installer: installs Node.js 22+ if missing (internet needed once), locks the data folder, opens the firewall for your home/office network only, registers an auto-start service (starts when the laptop is switched on, before anyone logs in; restarts after a crash or power cut), and stops the laptop sleeping when the lid is closed.

### First sign-in (National Administrator)
1. On the laptop that runs Jasmyle Properties, open `http://localhost:8080` (or double-click `open-jasmyle.bat`). The first time, the page says **Welcome to Jasmyle Properties**: enter your name, email and a strong password. This setup page works only on that laptop and only until the first administrator exists.
2. You are then asked to turn on two-factor protection: install Google Authenticator / Microsoft Authenticator on your phone, scan the QR code, type the 6-digit code, and keep the recovery codes safe.
3. You land on **National overview**. New landlords who register appear under **Landlords waiting for approval** with **Approve** / **Reject** buttons.
4. Next time: open the same address and use **National Administrator? Sign in here** (email, password, authenticator code).
5. **Looking after the server (Windows):** Desktop / Start Menu > **Jasmyle Manager**. It shows whether Jasmyle Properties is running, lets you Start / Stop / Restart it, shows the live log, makes a backup, checks the database, resets the administrator password and opens the data and backup folders. Jasmyle Properties also appears in Task Scheduler (task "Jasmyle Properties") and as `node.exe` in Task Manager. If it asks for permission, choose Yes.
6. Want sample data to explore every screen? Right-click `load-demo-data-windows.bat` > Run as administrator (only works on an empty system).


When finished it prints the addresses:
- This laptop: `http://localhost:8080`
- Phones/PCs on the same Wi-Fi: `http://192.168.x.x:8080`

First sign-in: you choose a new password and set up two-factor authentication (compulsory for the National Admin).

Restart manually: Windows `restart-windows.bat` (as Administrator) · Linux `sudo systemctl restart jasmyle`. 
Logs: Windows `C:\Jasmyle\data\logs\server.log` · Linux `journalctl -u jasmyle -f`. 
Uninstall: `scripts\uninstall-windows.ps1` / `sudo bash uninstall-linux.sh` (data is kept unless you ask to remove it).

## 2. Access from anywhere (away from home)

Do **not** open a router port. Use one of these; both encrypt traffic.

**A. Cloudflare Tunnel (public address for tenants and staff) – recommended**
1. Free Cloudflare account and a domain (e.g. `rent.yourdomain.com`).
2. Install `cloudflared` on the laptop, run `cloudflared tunnel login`, `cloudflared tunnel create jasmyle`, route DNS to the tunnel, and point the tunnel at `http://localhost:8080`.
3. Install it as a service: `cloudflared service install` (starts at boot).
4. Sign in as National Admin → **System** → set *Public address* to `https://rent.yourdomain.com`. (This turns on secure cookies and correct receipt/callback links.)

**B. Tailscale (private; only your own devices)** – install Tailscale on the laptop and your phone, then open `http://<laptop-tailscale-name>:8080`. Good for you alone, not for tenants.

## Android app and other hosting
- **Android app:** see `android/README.md` (build the APK with GitHub Actions or Android Studio; it connects to any Jasmyle Properties address you type once).
- **Any web host / cloud platform:** see `deploy/PORTABLE-HOSTING.md` (settings table, host comparison, moving between hosts).

## 3. Power cuts

- BIOS/UEFI: set **Power on after AC restore** (name varies: "Restore on AC power loss" = *Power On*). Keep the laptop plugged in; the battery acts as a mini-UPS. A small UPS for the router is worthwhile.
- The database uses write-ahead logging with full sync, so a sudden power-off does not corrupt data. If a file is ever damaged, the system restores the latest backup by itself on start.

## 4. Backups – important

- Automatic daily backups: `data/backups/` (Linux: `/var/lib/jasmyle/backups/`). Copy that folder to a USB drive or cloud drive regularly.
- **Also keep a copy of `data/secret.key`** somewhere safe and separate. It encrypts passwords' 2FA secrets, uploaded leases and payment keys. Without it, backups cannot be read. Never share it.
- Restore: stop the service, then `node scripts/restore.js <backup file>`, start the service.

## 5. Going live with payments

Every landlord starts in **Practice mode** (simulated payments) so they can test safely. In **Settings → Payments** a landlord (or you) enters their own credentials and switches to **Live**.
- **M-Pesa:** register at Safaricom Daraja, get Consumer Key/Secret, Shortcode, Passkey. Callback URL is shown in Settings and needs your public https address (section 2). 
- **PayPal (also cards):** create a REST app at developer.paypal.com; paste Client ID and Secret. Rent is converted from KES to USD at the rate set in Settings.
- **Bank:** tenants see the landlord's bank details and mark "I have paid"; the landlord confirms, and a receipt is issued.
- Credentials are encrypted at rest. Test with sandbox credentials first.

## 5b. How you earn: the platform fee per unit

The National Administrator (super admin) opens **Pricing & revenue** and sets, in plain screens:
- price bands per unit per month (default: first 5 units free, units 6-50 KES 40, 51+ KES 25 - change freely; free units keep small landlords happy),
- optional % of rent, a minimum fee, VAT on your fee, free-trial days, days to pay, and grace days,
- per-landlord discounts, flat prices, longer trials or full waivers.
A live calculator shows what a landlord with N units would pay. New prices apply to the next monthly invoice only.

**Where the money goes:** landlords pay their platform fee (M-Pesa STK, PayPal/card or bank) straight into YOUR paybill/till, PayPal or bank account, entered in the same page (changing them asks for your password again). Landlords' tenants still pay rent into the LANDLORD'S own accounts: the system does not hold or split tenants' rent, because taking a cut of other people's M-Pesa collections would make you a payment aggregator needing a Central Bank licence. If a landlord ignores invoices for longer than the grace period, adding new properties and tenants is paused; rent collection is never blocked.

## 5c. Kenya tax and KRA

Landlord menu **Tax & KRA** prepares: monthly rental income tax (MRI, 7.5% of gross residential rent for KES 288,000 to 15 million a year, due the 20th of the next month), VAT on commercial rent (16%, if VAT-registered), non-resident rules (30%), penalty estimates, a CSV for your return, and **eTIMS** e-invoices for commercial rent.
- Filing and paying is done by the landlord on KRA iTax/eRITS. I found no public KRA API for filing monthly rental returns, and KRA's GavaConnect eTIMS API was still "coming" in the sources I read, so nothing files on your behalf.
- eTIMS works in Practice mode now and can talk to KRA's sandbox using the OSCU method. KRA must vet and certify the integration before live use, so Production stays locked until you mark it verified. The field names/paths come from my knowledge of the OSCU specification and must be checked against the spec KRA gives you.
- Rates: the Finance Bill 2026 proposed raising MRI to 10%, but I could not confirm it was enacted; the shipped rate is 7.5%. Change it in **Integrations & tax rules** the day the law changes.

## 5d. Staying up to date when KRA / Safaricom change things

Rates, limits and the web addresses/paths of Daraja, PayPal and eTIMS are stored as a **rules pack** (Admin > Integrations & tax rules). You can edit rates directly (logged, reversible), import a pack, or give a feed address that is checked daily. Packs must be signed with your own publisher key (`node scripts/sign-rules.js keygen`, then `sign`), so fake packs are rejected. The page also shows whether Safaricom, PayPal and KRA servers are reachable. Limit: this keeps rates and addresses current; if Safaricom or KRA publish a genuinely new API format, the program itself needs a software update (replace the app folder; data is kept).

## 5e. Free cloud hosting (no laptop)

See `deploy/FREE-CLOUD-HOSTING.md` (Oracle Cloud Always Free + free HTTPS with Caddy, cloud-init file, Docker option, off-site backup script).

## 5e-2. Google Cloud
Step-by-step guide for a Compute Engine VM (free-tier eligible `e2-micro`, or a paid Johannesburg VM): `deploy/GOOGLE-CLOUD-HOSTING.md`, with a ready startup script `deploy/gcp-startup.sh`.

## 5f. Tenants changing phone number

Account page > Phone number. Needs the current password, then either an SMS code to the new number (when SMS is configured) or landlord/manager approval. Landlords/managers can also edit a tenant's number directly. A number held by a tenant with a lease cannot be taken; a former tenant's number is released so they can rent from another landlord. The National Admin chooses the policy in Platform settings.

## 5g. Photos, videos, viewings and the rental passport
- **Landlords/managers:** open a property, press **Photos** on a unit. Upload photos (shrunk automatically), a floor plan, up to 3 videos, and set a cover. Add a YouTube/Vimeo/Matterport/Kuula tour link in the unit form. Media shows publicly only while the property is verified and the unit is listed and vacant.
- **Visitors:** search, save favourites, compare up to 3 houses, share on WhatsApp, **book a viewing** (the landlord confirms by SMS; the address is revealed once confirmed) and **save a search** to get SMS alerts (max 3/day).
- **Landlords:** **Viewings** page to confirm, decline, mark done or no-show.
- **Tenants:** Account > Rental passport creates an expiring link showing on-time rate and months rented (no ID, phone or address).
- **API reference:** `/docs.html` (sign in first), generated from the live route table.
- **Tests:** `npm run test:unit`, `npm test` (API, 294 checks), `npm run test:ui` (browser; needs `npm i playwright`), `npm run test:all`. See `ROADMAP.md` for what is deliberately not built.

## 5h. Water & electricity billing
Landlord menu **Water & electricity** (managers see it too; caretakers see it as **Meter readings**).
1. The landlord opens **Rates** and sets a price per m³ (water) or kWh (electricity), an optional fixed monthly charge and days to pay, per property. Only the landlord can change rates.
2. Each month, type every unit's meter reading on the sheet. Usage and the bill are worked out as you type; unusually high usage is flagged in red. The first reading for a unit is only its starting point; billing starts the next month. Replaced a meter? Tick **New meter** and enter its opening number.
3. **Save & bill tenants** issues one invoice per unit (tenants are notified and pay it like rent). A caretaker can just save readings; the landlord or manager later presses **Bill saved readings**. A bill can be cancelled (Rent & payments), then the reading corrected and billed again.

## 5i. Importing from a spreadsheet (CSV)
Landlord/manager menu **Import from CSV**. Download the template, fill it in Excel, save as *CSV (Comma delimited)*, choose it and press **Check the file**. Every row is marked Ready or Problem (with the reason) and nothing is saved until you press **Import**. Bad rows are skipped and good rows added; importing the same file again never creates duplicates.
- **Units:** property, unit, type, bedrooms, rent, deposit, floor.
- **Tenants:** unit, name, phone (required) plus property, email, national_id, move_in (YYYY-MM-DD or DD/MM/YYYY), rent, deposit, due_day, emergency_contact. This creates the tenant's account and lease. By default rent is billed from the current month only and deposits are treated as already paid, so moving existing tenants in does not create a pile of old unpaid invoices. After import, download the list of temporary passwords (shown once).

## 6. Who can do what (summary)

| Role | Can | Cannot |
|---|---|---|
| **National Administrator** | Approve/suspend landlords, verify properties, manage platform admins (super only), view system health, audit trail, backups, aggregate statistics | See tenants' private chats, payments detail, leases or files of any landlord; record rent |
| **Landlord** | Own properties, units, tenants, leases, rent, expenses, reports, staff, approve maintenance, settings | See any other landlord's data or platform settings |
| **Property manager** | Manage only assigned properties: tenants, invoices, payments, inspections, repairs (up to an approval limit; above it goes to the landlord), caretakers, contractors | Touch other properties, change payment keys, delete the landlord's records |
| **Caretaker** | Assigned property: log/update repairs, inspections, chat | See rent figures or repair costs |
| **Contractor** | Only jobs assigned to them: update status, add quotes/photos | Anything else |
| **Tenant** | Own lease, invoices, pay, receipts, report repairs with photos/video, chat, history | Anyone else's data |

Out-of-scope records return "not found", so the existence of others' data is never revealed. All sensitive actions are written to a tamper-evident audit log.

## 7. Security in brief

Strong password rules, lockout after repeated failures, rate limiting, CSRF protection, strict browser security headers, mandatory 2FA for the National Admin, AES-256-GCM encryption of sensitive fields and uploaded files, hash-chained audit log, file type checks, optional admin IP allow-list (`NH_ADMIN_IPS` or `adminIpAllowlist` in `data/config.json`).

## 8. Forgot the admin password?

On the laptop: `node scripts/setup.js reset-admin` (Linux: `sudo -u jasmyle env NH_DATA_DIR=/var/lib/jasmyle node /opt/jasmyle/scripts/setup.js reset-admin`). Check health: `node scripts/setup.js check`.

## 9. Try it with sample data

`npm run demo-data` creates sample landlords, managers, tenants and payments (random passwords are printed). Do not run this on a real installation.

## 10. Honest notes

- M-Pesa and PayPal live connections need your own provider credentials and a public https address; they were tested here in practice mode and with simulated callbacks, not against the live providers.
- When a tenant moves to another landlord, they get a new account (their old landlord keeps the old record).
- 2FA uses a typed setup key (works with Google/Microsoft Authenticator, Authy).
- A tenant's phone number must be unique across the system.
- Run `npm run test:all` for the automated checks (unit, API and browser).


## 7. v7 – the whole real-estate ecosystem (new)

| Module | What it does | Who |
|---|---|---|
| **Real estate hub** (`#/ecosystem`) | One overview of every module | Landlord, manager, caretaker |
| **Sales & land** | List houses, plots, farms, commercial space; photos; National Administration verifies before the public sees it; public `#/buy` | Landlord, manager |
| **Leads & deals** | Buyer/tenant pipeline (new → won/lost), notes and follow-up reminders, deals with commission %, closes the listing as sold; CSV export | Landlord, manager |
| **Short stays** | Holiday-let bookings, overlap prevention, check-in/out, balance, arrival SMS | Landlord, manager |
| **Projects** | Development/renovation budget vs spend, milestones, progress | Landlord |
| **Assets & servicing** | Lifts, generators, boreholes…; service schedule, warranty, history, adds cost to expenses | Landlord, manager (caretaker views) |
| **Licences & insurance** | Expiry tracking with 30-day / 7-day / expired alerts | Landlord, manager (view) |
| **Services directory** (`#/services`) | Valuers, surveyors, architects, lawyers, movers…; apply, admin approval, requests | Public + National Admin |
| **Search** | Global search that never crosses landlords | Org staff |

New roles are not needed: a **property manager acts as the estate agent/broker**; buyers, visitors and providers use public pages without accounts.

### Legal pages and data protection
- `#/about` (what the system is), `#/terms` (Terms & Conditions), `#/privacy` (Privacy Notice) are public and served by the API (`/api/public/legal`), versioned in `server/legal.js`.
- Acceptance is **recorded** (version, time, IP) at landlord registration and at next sign-in for everyone; public forms (viewings, alerts, sale enquiries, provider applications) require a consent tick which is also recorded.
- **Privacy centre**: instant download of your own data (JSON), data-subject requests (access, correction, erasure, objection, restriction, portability, withdraw consent) with a 30-day due date, replies, consent history. Visitors without accounts use `#/data-request`.
- Admin > **Privacy & legal**: enter the data-controller name, DPO, **ODPC registration number**; answer requests; anonymise visitor data on erasure.
- Automatic **retention clean-up** (leads/viewings/service requests 24 months, stopped alerts 6 months).
- **Important:** the legal text is a carefully drafted template for the Data Protection Act, 2019, its 2021 Regulations and related Kenyan law. It is not legal advice. Before going live: register with the Office of the Data Protection Commissioner, fill in the controller details, and have a Kenyan advocate review the Terms and Privacy Notice.

### Server upgrades
gzip compression (API and static files), request IDs, slow-request log, live metrics (Admin > **Server health**), `/api/public/ready` readiness check, connection cap (`NH_MAX_CONNECTIONS`), larger SQLite cache, nightly `PRAGMA optimize` and weekly `ANALYZE`, reminder and retention background jobs. Tests: `npm run test:all` (30 unit, 405 API, 40 browser checks).

Note: the internal environment variables still start with `NH_` and the installers use the folder name `Jasmyle` (e.g. `C:\Jasmyle`). A fresh install uses the database file `jasmyle.db`; to move an old installation, rename `nyumbahub.db` to `jasmyle.db` in the data folder.
