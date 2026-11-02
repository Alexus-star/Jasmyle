'use strict';
// First-time setup and emergency recovery. Run on the laptop that hosts the system.
//   node scripts/setup.js                 -> create the first (super) National Administrator
//   node scripts/setup.js reset-admin     -> forgot the admin password/2FA? (needs physical access to the laptop)
//   node scripts/setup.js check           -> verify the database and audit trail
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const cfg = require('../server/config');
const S = require('../server/store');
const sec = require('../server/sec');
const D = require('../server/domain');
const U = require('../server/util');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q, def) => new Promise((res) => rl.question(def ? `${q} [${def}]: ` : `${q}: `, (a) => res(a.trim() || def || '')));
const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : undefined; };

(async () => {
  const cmd = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'setup';
  S.open(); sec.master();
  console.log('\n=== Jasmyle Properties setup ===\n');

  if (cmd === 'check') {
    console.log('Database integrity: OK');
    const v = S.audit.verify();
    console.log(v.ok ? `Audit trail: OK (${v.checked} events, no tampering found)` : `Audit trail: PROBLEM at event ${v.brokenAt}`);
    rl.close(); S.close(); return;
  }

  if (cmd === 'reset-admin') {
    const email = (arg('email') || (await ask('Email of the administrator to recover'))).toLowerCase();
    const u = S.db.users.find('email', email);
    if (!u || u.role !== 'national_admin') { console.log('No National Administrator with that email.'); rl.close(); S.close(); process.exit(1); }
    const temp = sec.genPassword();
    S.db.users.update(u.id, { passHash: await sec.hashPassword(temp), mustChangePassword: true, failed: 0, lockedUntil: 0, totp: null, recovery: [], status: 'active' });
    for (const s of S.db.sessions.where('userId', u.id)) S.db.sessions.remove(s.id);
    S.audit.append({ actor: u.id, role: 'national_admin', action: 'admin.recovered_on_server', entity: 'user', entityId: u.id, detail: { via: 'console' } });
    console.log(`\nDone. Temporary password for ${email}:\n\n    ${temp}\n\nSign in, choose a new password and set up two-factor authentication again.`);
    rl.close(); S.close(); return;
  }

  if (S.db.users.where('role', 'national_admin').length) {
    console.log('A National Administrator already exists. To recover access run:  node scripts/setup.js reset-admin');
    rl.close(); S.close(); return;
  }
  const name = arg('name') || (await ask('Your full name'));
  const email = (arg('email') || (await ask('Your email (this is your sign-in name)'))).toLowerCase();
  const phone = arg('phone') || (arg('email') ? '' : await ask('Your phone number (optional)', ''));
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { console.log('A name and a valid email are required.'); rl.close(); S.close(); process.exit(1); }
  const typed = arg('password') || (arg('email') ? '' : await ask('Choose a password, or press Enter for a strong generated one', ''));
  if (typed) { const why = sec.checkPassword(typed, { email, name }); if (why) { console.log(why); rl.close(); S.close(); process.exit(1); } }
  const { user, tempPassword } = await D.makeUser({ role: 'national_admin', ownerId: null, name, email, phone: phone ? U.normPhone(phone) || undefined : undefined, isSuper: true, status: 'active' }, { password: typed || undefined });
  S.audit.append({ actor: user.id, role: 'national_admin', action: 'admin.super_created', entity: 'user', entityId: user.id, detail: { via: 'setup' } });

  // default config file (only if absent)
  const cfgFile = path.join(cfg.paths.data, 'config.json');
  if (!fs.existsSync(cfgFile)) {
    const port = Number(arg('port') || (arg('email') ? cfg.port : await ask('Port number for the system', String(cfg.port)))) || 8080;
    fs.writeFileSync(cfgFile, JSON.stringify({ appName: 'Jasmyle Properties', port, timezone: 'Africa/Nairobi', currency: 'KES', adminIpAllowlist: [] }, null, 2));
  }
  console.log('\nAll set!\n');
  console.log(`  Sign in with:  ${email}`);
  if (tempPassword) console.log(`  Temporary password:  ${tempPassword}   (shown only once - write it down)`);
  console.log('\nOn first sign-in you will choose a new password and set up two-factor authentication.\n');
  rl.close(); S.close();
})().catch((e) => { console.error('Setup failed:', e.message); process.exit(1); });
