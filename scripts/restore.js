'use strict';
// Restore the database from a backup file.   STOP the service first, then:
//   node scripts/restore.js data/backups/jasmyle-20261024-101500-auto.db
const fs = require('fs'); const path = require('path'); const cfg = require('../server/config');
const src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.log('Usage: node scripts/restore.js <backup file>\nAvailable:'); try { for (const f of fs.readdirSync(cfg.paths.backups)) console.log('  ' + path.join(cfg.paths.backups, f)); } catch { /* none */ } process.exit(1); }
const { DatabaseSync } = require('node:sqlite');
const t = new DatabaseSync(src); const r = t.prepare('PRAGMA integrity_check').get(); t.close();
if (Object.values(r)[0] !== 'ok') { console.log('That backup file is damaged. Choose another.'); process.exit(1); }
if (fs.existsSync(cfg.paths.db)) fs.copyFileSync(cfg.paths.db, cfg.paths.db + '.before-restore-' + Date.now());
for (const e of ['-wal', '-shm']) { try { fs.unlinkSync(cfg.paths.db + e); } catch { /* ignore */ } }
fs.copyFileSync(src, cfg.paths.db);
console.log('Restored. Start the service again. (The previous database was kept as *.before-restore-*)');
