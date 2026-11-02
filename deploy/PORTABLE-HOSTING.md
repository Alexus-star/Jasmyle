# Run Jasmyle Properties on any hosting

Jasmyle Properties is one Node.js program (Node 22.13+, no npm packages) plus one folder of data. That is all a host needs to provide:
**(1) run `node supervisor.js`, (2) keep the `data` folder on a permanent disk, (3) put HTTPS in front.**
The web app and the Android app both just talk to the same address, so you can move between hosts without changing either.

## Settings (environment variables, or `data/config.json`)
| Variable | Meaning | Default |
|---|---|---|
| `PORT` or `NH_PORT` | Port to listen on (cloud platforms set `PORT` for you) | 8080 |
| `NH_HOST` | Address to listen on. Leave empty to listen everywhere; use `127.0.0.1` if a proxy on the same machine is the only way in | everywhere |
| `NH_DATA_DIR` | Folder for the database, uploaded files, backups, logs and `secret.key`. **Must be on a permanent disk.** | `./data` |
| `NH_PUBLIC_URL` | Your public https address (used for M-Pesa/PayPal callbacks and links) | none |
| `NH_TRUSTED_PROXIES` | Which proxies' `X-Forwarded-*` headers are believed: `any` (only when the platform proxy is the ONLY way in), or a list like `10.0.,172.16.` | this machine only |
| `NH_SETUP_TOKEN` | A secret that lets you create the first administrator from a remote browser (type it on the setup page) | off (setup only on the server itself) |
| `NH_TZ` | Time zone | Africa/Nairobi |
| `NH_ADMIN_IPS` | Optional: only these addresses may sign in as National Administrator | any |

Health check URL for any monitor or platform: `/api/public/health` (returns 200). Identity check used by the apps: `/api/public/info`.

## Choose a host
| Host type | How | Notes |
|---|---|---|
| **Your laptop/PC (Windows)** | `install-windows.bat`; reach it from outside with Cloudflare Tunnel | See README. Cheapest, least reliable |
| **Any Linux VPS** (Oracle free, Google Cloud, DigitalOcean, Hetzner, Safaricom/Truehost VPS...) | `sudo bash install-linux.sh`, then Caddy from `deploy/Caddyfile` for free HTTPS | Best choice. See FREE-CLOUD-HOSTING.md |
| **Docker anywhere** | `deploy/docker-compose.yml` (app + Caddy) | `docker run -p 8080:8080 -v jasmyle:/data -e NH_SETUP_TOKEN=... image` also works behind your own proxy |
| **App platforms** (Railway, Render, Fly.io, Koyeb...) | Deploy the `deploy/Dockerfile`. Attach a **persistent volume** mounted at `/data`. Set `NH_TRUSTED_PROXIES=any`, `NH_SETUP_TOKEN=<a long secret>`, `NH_PUBLIC_URL=https://your-app-address` | Do **not** use plans that sleep or have a temporary disk: the database would be lost and payment callbacks missed |
| **cPanel / shared hosting with "Setup Node.js App"** | Upload the folder, startup file `server.js`, Node 22+; set the variables above | Many shared hosts only offer old Node versions: check it is 22.13 or newer |

## After the first start
1. Open your address. On a cloud host the setup page asks for your **setup code** (`NH_SETUP_TOKEN`) plus your admin details.
2. Sign in as National Administrator > **System** and confirm *Public address*.
3. Take a backup (System > Backups), and copy `data/backups` and `data/secret.key` somewhere safe off the server.
4. Install the Android app (see `android/README.md`) and connect it to the same address.

## Moving to another host
Stop the service, copy the whole `data` folder (including `secret.key`) to the new host, start it, point your domain at the new address. Nothing else changes; the apps keep working because they use your domain name.
