# Deploy Jasmyle Properties on Railway (about 15 minutes)

Cost: roughly US$5 a month. Railway: https://railway.com

## A. Put the files on GitHub (Railway deploys from there)
1. Create a free account at https://github.com and click **New repository**. Name it `jasmyle`, choose **Private**, click Create.
2. Click **uploading an existing file**. Open this folder on your computer and drag in EVERYTHING inside it (the `Dockerfile`, `server`, `public`, `scripts`, etc. - not the folder itself). Click **Commit changes**.

## B. Create the project on Railway
1. Sign up at https://railway.com using GitHub. Add a card / choose the Hobby plan.
2. **New Project > Deploy from GitHub repo** > pick `jasmyle`. It finds the Dockerfile by itself.
3. Open the service > **Variables** and add these four:
   - `NH_TRUSTED_PROXIES` = `any`
   - `NH_SETUP_TOKEN` = a long secret you invent (example: `blue-mango-river-7342-kenya`). Write it down.
   - `NH_PUBLIC_URL` = leave for step 6
   - `RAILWAY_RUN_UID` = `0`
4. Right-click the service (or press Ctrl+K) > **Attach Volume**. Set the **mount path to `/data`**. THIS IS ESSENTIAL: without it the database is lost on every restart.
5. Service > **Settings > Networking > Generate Domain**. Railway gives you an address like `https://jasmyle-production.up.railway.app`. (Later you can add your own domain here.)
6. Go back to **Variables**, set `NH_PUBLIC_URL` to that address (with https://). The service redeploys.

## C. First sign-in
1. Open your address. The setup page asks for your **setup code** (the `NH_SETUP_TOKEN`), plus your name, email and password.
2. Turn on two-factor with Google/Microsoft Authenticator and keep the recovery codes.
3. Sign in as National Administrator > **System**, confirm *Public address*, then take a backup.

## D. Do not skip
- Download a backup regularly (System > Backups) and keep a copy of the secret key (`secret.key`) away from Railway. Without it, backups cannot be read.
- Test M-Pesa/PayPal with sandbox credentials before going Live.
- If the page does not load: Railway > service > **Deployments > View logs**.
