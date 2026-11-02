# Put Jasmyle Properties on a free cloud server (no laptop needed)

**Honest summary:** free cloud servers exist, but their limits change. As of late 2026, Oracle Cloud's "Always Free" tier is the best fit (a small always-on Linux server with permanent disk), though reports say Oracle trimmed the ARM allowance in 2026 - check the limits shown in your own account. Google Cloud also has a free small VM: see `GOOGLE-CLOUD-HOSTING.md` and `deploy/gcp-startup.sh`. Avoid free "web service" plans that sleep or wipe their disk (e.g. free Render/Heroku-style plans): Jasmyle Properties keeps its database on disk and must be always on to receive M-Pesa callbacks.

You need: a free account (card verification is usually required), a domain name (a `.co.ke` is cheap; or a free dynamic-DNS name), and 30 minutes.

## Steps (Oracle Cloud example)
1. Create an Always Free account, then **Compute → Create instance → Ubuntu 22.04/24.04**, shape "Always Free eligible" (Ampere A1 or AMD Micro). Download the SSH key. 1 GB RAM is enough for small portfolios; use the Ampere shape for thousands of units.
2. In the instance's **Virtual Cloud Network → Security list**, allow inbound TCP **80** and **443** (and 22 for you).
3. Point your domain's **A record** to the server's public IP.
4. Upload `Jasmyle-System.zip` to the server (`scp`), or paste `deploy/cloud-init.yaml` into "user data" when creating the instance (edit the domain and zip link first).
5. On the server: `unzip Jasmyle-System.zip && cd jasmyle && sudo bash install-linux.sh`. It installs the system as a boot service.
6. Install the free HTTPS front door: `sudo apt install -y caddy`, put `deploy/Caddyfile` at `/etc/caddy/Caddyfile` with your domain, `sudo systemctl restart caddy`.
7. In Jasmyle Properties sign in as National Admin → **System** → set Public address `https://your-domain`. Done: tenants and landlords open that address from anywhere. Then go to **Pricing & revenue → Where your money goes** to add your M-Pesa/PayPal/bank for platform fees.

**Docker alternative:** `deploy/docker-compose.yml` (Caddy + app, one command).
**No domain yet?** Use a Cloudflare Tunnel from the server instead - see README "Access from anywhere".

## Keep it safe
- Backups live on the same server. Schedule `scripts/offsite-backup.sh` (rclone to a cloud drive) so a lost server doesn't lose your business. Keep `secret.key` safe too.
- Turn on automatic security updates: `sudo apt install unattended-upgrades`.
- Cloud servers can be reclaimed if idle or if free terms change - log in occasionally, and keep off-site backups so you can rebuild in 30 minutes anywhere (even a paid KES 600/month VPS).
- Moving from laptop to cloud: stop the service, copy the whole `data` folder (including `secret.key`) to the new server's data folder, start the service.
