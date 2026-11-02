'use strict';
// Friendly stop if Node.js is too old (the app uses the built-in database that arrived in Node 22.13).
(function () {
  const v = process.versions.node.split('.').map(Number);
  if (v[0] > 22 || (v[0] === 22 && v[1] >= 13)) return;
  const msg = `\nJasmyle Properties needs Node.js 22.13 or newer, but this computer has Node.js ${process.versions.node}.\n` +
    'Install the current "LTS" version from https://nodejs.org (free), close this window, and start Jasmyle Properties again.\n';
  try { require('fs').appendFileSync(require('path').join(process.env.NH_DATA_DIR || require('path').join(__dirname, '..', 'data'), 'logs', 'server.log'), msg); } catch { /* ignore */ }
  console.error(msg);
  process.exit(1);
})();
// Central configuration. Order of precedence: environment variables > data/config.json > defaults.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA = process.env.NH_DATA_DIR ? path.resolve(process.env.NH_DATA_DIR) : path.join(ROOT, 'data');

function loadJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}
const file = loadJson(path.join(DATA, 'config.json'));
const num = (v, d) => (v !== undefined && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
const bool = (v, d) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', true].includes(v));
const list = (v) => (Array.isArray(v) ? v : String(v || '').split(',')).map((s) => String(s).trim()).filter(Boolean);

const cfg = {
  appName: process.env.NH_APP_NAME || file.appName || 'Jasmyle Properties',
  port: num(process.env.NH_PORT || process.env.PORT || file.port, 8080),
  host: process.env.NH_HOST || file.host || '', // '' = listen on every address, IPv4 and IPv6 (so http://localhost works on Windows)
  // Public HTTPS address (e.g. https://rent.example.com) - needed for M-Pesa/PayPal callbacks.
  // Can also be changed later by the National Administrator inside the app.
  publicUrl: String(process.env.NH_PUBLIC_URL || file.publicUrl || '').replace(/\/+$/, ''),
  // Trust X-Forwarded-* headers ONLY when the connection comes from this same machine
  // (Cloudflare Tunnel / Tailscale / nginx running on the laptop).
  trustProxy: bool(process.env.NH_TRUST_PROXY, file.trustProxy !== undefined ? !!file.trustProxy : true),
  // Hosts whose X-Forwarded-* headers are believed. Default: only a proxy on this same machine.
  // Cloud platforms (Render, Railway, Fly, cPanel...) put their proxy on another address: set NH_TRUSTED_PROXIES=any
  // (ONLY when the app is reachable exclusively through the platform's proxy) or a list like 10.0.,172.16.
  trustedProxies: list(process.env.NH_TRUSTED_PROXIES || file.trustedProxies),
  // Lets the first administrator be created from a remote browser (cloud hosting) by typing this secret on the setup page.
  setupToken: String(process.env.NH_SETUP_TOKEN || file.setupToken || ''),
  timezone: process.env.NH_TZ || file.timezone || 'Africa/Nairobi',
  currency: file.currency || 'KES',
  adminIpAllowlist: list(process.env.NH_ADMIN_IPS || file.adminIpAllowlist),
  maxConnections: num(process.env.NH_MAX_CONNECTIONS || file.maxConnections, 2000),
  tlsCert: process.env.NH_TLS_CERT || file.tlsCert || '',
  tlsKey: process.env.NH_TLS_KEY || file.tlsKey || '',
  paths: {
    root: ROOT,
    data: DATA,
    files: path.join(DATA, 'files'),
    backups: path.join(DATA, 'backups'),
    logs: path.join(DATA, 'logs'),
    db: path.join(DATA, 'jasmyle.db'),
    public: path.join(ROOT, 'public'),
  },
  limits: {
    json: 256 * 1024,
    image: 12 * 1024 * 1024,
    doc: 15 * 1024 * 1024,
    video: 40 * 1024 * 1024,
  },
  session: {
    // [idle timeout, absolute lifetime] in milliseconds, per role
    national_admin: [30 * 60e3, 12 * 3600e3],
    landlord: [8 * 3600e3, 7 * 86400e3],
    property_manager: [8 * 3600e3, 7 * 86400e3],
    caretaker: [12 * 3600e3, 14 * 86400e3],
    contractor: [12 * 3600e3, 14 * 86400e3],
    tenant: [24 * 3600e3, 30 * 86400e3],
  },
  backupsToKeep: 30,
};

module.exports = cfg;
