'use strict';
// Make a database backup right now (safe while Jasmyle Properties is running).   node scripts/backup.js
const S = require('../server/store');
S.open();
const f = S.backup('manual');
console.log('Backup saved: ' + f);
S.close();
