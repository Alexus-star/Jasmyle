'use strict';
(async function () {
  const out = document.getElementById('out'), q = document.getElementById('q'); let spec;
  function el(t, c, x) { const e = document.createElement(t); if (c) e.className = c; if (x !== undefined) e.textContent = x; return e; }
  function draw() { const f = q.value.toLowerCase(); out.textContent = ''; let n = 0;
    for (const [path, ops] of Object.entries(spec.paths)) for (const [m, o] of Object.entries(ops)) { const line = `${m} ${path} ${o.summary || ''} ${o['x-permission'] || ''}`.toLowerCase(); if (f && !line.includes(f)) continue; n++;
      const d = el('div', 'ep'); const mm = el('span', 'm ' + m.toUpperCase(), m.toUpperCase()); d.append(mm, el('code', '', path)); const meta = []; if (o['x-permission']) meta.push('needs permission: ' + o['x-permission']); else if (o.security && !o.security.length) meta.push('public'); if (o['x-roles']) meta.push('roles: ' + [].concat(o['x-roles']).join(', ')); if (o['x-rate-limit']) meta.push('rate limit: ' + JSON.stringify(o['x-rate-limit']));
      if (meta.length) d.append(el('div', 'small muted', meta.join(' · '))); if (o.summary) d.append(el('div', 'small', o.summary)); out.append(d); }
    if (!n) out.textContent = 'Nothing matches.'; }
  try { const r = await fetch('/api/docs/openapi.json', { credentials: 'same-origin' }); if (!r.ok) throw new Error(r.status === 401 ? 'Please sign in to Jasmyle Properties first, then reload this page.' : 'Could not load the API description.'); spec = await r.json(); q.addEventListener('input', draw); draw(); } catch (e) { out.textContent = e.message; }
})();
