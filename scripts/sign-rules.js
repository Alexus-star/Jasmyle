'use strict';
// Publisher tool (run on YOUR secure computer, not on the server).
//   node scripts/sign-rules.js keygen                      -> creates rules-private.pem and prints the PUBLIC key to paste in Admin
//   node scripts/sign-rules.js sign pack.json out.json     -> pack.json = {version, issuedAt, data:{tax:{...},integrations:{...}}}
const fs = require('fs'); const crypto = require('crypto');
const { canon } = require('../server/rules');
const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'keygen') {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  fs.writeFileSync('rules-private.pem', privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  console.log('Private key saved to rules-private.pem - keep it OFFLINE and never upload it.\nPublic key (paste into Admin > Integrations & tax rules):\n' + publicKey.export({ type: 'spki', format: 'der' }).toString('base64'));
} else if (cmd === 'sign' && a && b) {
  const pack = JSON.parse(fs.readFileSync(a, 'utf8'));
  const key = crypto.createPrivateKey(fs.readFileSync('rules-private.pem'));
  pack.sig = crypto.sign(null, Buffer.from(canon({ version: pack.version, issuedAt: pack.issuedAt, data: pack.data })), key).toString('base64');
  fs.writeFileSync(b, JSON.stringify(pack, null, 2)); console.log('Signed pack written to ' + b + '. Host it at a URL (feed) or import the file in Admin.');
} else console.log('Usage: node scripts/sign-rules.js keygen | sign pack.json out.json');
