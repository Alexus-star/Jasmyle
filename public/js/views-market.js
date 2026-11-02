'use strict';
/* Marketplace: listing photos/videos, public listing page, saved & compare, viewing bookings, search alerts, rental passport. */
(function () {
  const { h, icon, money, fdate, fdt, ago, route } = NH;
  const { card, stat, empty, pageHead, table, toast, modal, busy, confirmBox } = NH.ui;
  const note = (cls, ...c) => h('div', { class: 'note ' + cls }, ...c);
  const field = (label, inp, hint) => h('div', { class: 'f' }, h('label', null, label), inp, hint ? h('div', { class: 'hint' }, hint) : null);
  const mediaUrl = (id) => '/api/public/media/' + id;

  /* ---- favourites & compare (stored only on the visitor's own phone) ---- */
  const store = (k) => ({ get() { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } }, set(v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } } });
  const favs = store('nh_favs'), cmp = store('nh_cmp');
  const toggle = (s, id, max) => { const a = s.get(); const i = a.indexOf(id); if (i >= 0) a.splice(i, 1); else { if (max && a.length >= max) { toast(`You can compare up to ${max} houses`, 'bad'); return a; } a.push(id); } s.set(a); return a; };

  /* ---- public listing card ---- */
  function listingCard(l) {
    const cover = l.media.find((m) => m.kind === 'photo'); const vids = l.media.filter((m) => m.kind === 'video').length; const photos = l.media.filter((m) => m.kind === 'photo').length;
    const heart = h('button', { class: 'heart', title: 'Save', 'aria-label': 'Save this house', onclick: (e) => { e.stopPropagation(); toggle(favs, l.id); heart.classList.toggle('on', favs.get().includes(l.id)); } }, '♥'); heart.classList.toggle('on', favs.get().includes(l.id));
    return h('div', { class: 'card lcard', onclick: () => NH.go('/listing/' + l.id) },
      h('div', { class: 'cover' }, cover ? h('img', { src: mediaUrl(cover.id), alt: l.type, loading: 'lazy' }) : h('div', { class: 'nophoto' }, icon('building'), h('span', null, 'No photos yet')), heart,
        h('div', { class: 'badges' }, photos ? h('span', null, '📷 ' + photos) : null, vids ? h('span', null, '🎥 ' + vids) : null, l.tourUrl ? h('span', null, '360° tour') : null)),
      h('div', { class: 'lbody' }, h('div', { class: 'row between' }, h('b', { class: 'blue', style: { fontSize: '1.25rem' } }, money(l.rent), h('span', { class: 'small muted' }, ' /mo')), NH.badge('Verified', 'ok')),
        h('div', { class: 'bold' }, `${l.type}${l.bedrooms ? ' · ' + l.bedrooms + ' bed' : ''}${l.bathrooms ? ' · ' + l.bathrooms + ' bath' : ''}`), h('div', { class: 'muted small' }, `${l.property}, ${l.town}, ${l.county}`),
        h('div', null, l.furnished ? h('span', { class: 'chip' }, 'Furnished') : null, ...(l.amenities || []).slice(0, 3).map((a) => h('span', { class: 'chip' }, a)))));
  }

  /* ---- search page (replaces the basic one) ---- */
  NH.routes = NH.routes.filter((r) => r.pattern !== '/find');
  route('/find', async () => {
    const county = h('select', null, h('option', { value: '' }, 'All counties')); const search = h('input', { type: 'search', placeholder: 'Area, estate or type e.g. Kilimani' }); const max = h('input', { type: 'number', placeholder: 'Max rent (KES)' });
    const beds = h('select', null, [['', 'Any bedrooms'], ['1', '1+'], ['2', '2+'], ['3', '3+']].map(([v, l]) => h('option', { value: v }, l))); const withMedia = h('input', { type: 'checkbox' });
    const out = h('div', { class: 'grid auto' }); const count = h('p', { class: 'muted' }); let last = {};
    async function load() {
      const qs = new URLSearchParams(); if (county.value) qs.set('county', county.value); if (search.value) qs.set('q', search.value); if (max.value) qs.set('maxRent', max.value); if (beds.value) qs.set('bedrooms', beds.value); last = Object.fromEntries(qs);
      try { const d = await NH.api('GET', '/api/public/listings?' + qs, undefined, { quiet: true }); if (county.options.length === 1) for (const c of d.counties) county.append(h('option', { value: c }, c));
        let rows = d.listings; if (withMedia.checked) rows = rows.filter((l) => l.media.length); count.textContent = d.disabled ? 'Public search is switched off for now.' : `${rows.length} verified home(s) available`;
        NH.clear(out).append(...(rows.length ? rows.map(listingCard) : [empty('No homes match. Try different filters, or save this search and we will text you.', 'search')])); } catch (e) { toast(e.message, 'bad'); }
    }
    const ph = h('input', { type: 'tel', placeholder: 'Your phone, e.g. 0712 345 678' }); const acons = h('input', { type: 'checkbox' });
    const alertBox = card(h('h3', null, '🔔 Get a text when a matching house is listed'), h('div', { class: 'row' }, h('div', { class: 'grow' }, ph), h('button', { class: 'btn red', onclick: (e) => busy(e.currentTarget, async () => { const r = await NH.api('POST', '/api/public/alerts', { phone: ph.value, consent: acons.checked, ...last }, { quiet: true }); toast(r.message, 'ok'); ph.value = ''; }) }, 'Save this search')), h('label', { class: 'chk small' }, acons, h('span', null, 'I agree to receive SMS alerts. Uses the filters above; at most 3 texts a day; stop any time. See the ', h('a', { href: '#/privacy' }, 'Privacy Notice'), '.')));
    [county, beds, withMedia].forEach((e) => e.addEventListener('change', load)); max.addEventListener('change', load); let t; search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 350); });
    load();
    return h('div', { class: 'stack' }, h('div', { class: 'card hero' }, h('h1', { style: { color: '#fff' } }, 'Find a verified home'), h('p', null, 'Photos, videos and virtual tours. Every landlord is checked by National Administration. Book a viewing in 30 seconds.'), h('div', { class: 'row', style: { marginTop: '.5rem' } }, h('a', { class: 'btn', style: { background: '#fff', color: 'var(--b8)' }, href: '#/saved' }, '♥ Saved'), h('a', { class: 'btn', style: { background: '#fff', color: 'var(--b8)' }, href: '#/compare' }, 'Compare'))),
      h('div', { class: 'card' }, h('div', { class: 'form-grid' }, field('Search', search), field('County', county), field('Max rent', max), field('Bedrooms', beds), h('div', { class: 'f' }, h('label', { class: 'chk' }, withMedia, 'Only houses with photos or video')))), count, out, alertBox);
  }, { auth: false, title: 'Find a home' });

  /* ---- one listing: gallery, details, viewing, share ---- */
  const embed = (u) => { try { const x = new URL(u); if (/youtu\.be$/.test(x.hostname)) return 'https://www.youtube.com/embed/' + x.pathname.slice(1); if (/youtube\.com$/.test(x.hostname) && x.searchParams.get('v')) return 'https://www.youtube.com/embed/' + x.searchParams.get('v'); } catch { /* fall through */ } return null; };
  route('/listing/:id', async (p) => {
    const { listing: l } = await NH.api('GET', '/api/public/listings/' + p.id, undefined, { quiet: true });
    const photos = l.media.filter((m) => m.kind !== 'video'); const vids = l.media.filter((m) => m.kind === 'video');
    const hero = h('div', { class: 'hero-media' }); let idx = 0;
    const items = [...photos.map((m) => ({ t: 'img', id: m.id, k: m.kind })), ...vids.map((m) => ({ t: 'video', id: m.id }))];
    const thumbs = h('div', { class: 'photos', style: { marginTop: '.5rem' } });
    const show = (i) => { idx = i; const it = items[i]; NH.clear(hero).append(it.t === 'img' ? h('img', { src: mediaUrl(it.id), alt: l.type, onclick: () => modal(l.type, h('img', { src: mediaUrl(it.id), style: { width: '100%', borderRadius: '10px' } }), { wide: true }) }) : h('video', { src: mediaUrl(it.id), controls: true, preload: 'metadata', playsinline: true }), items.length > 1 ? h('div', { class: 'row between navs' }, h('button', { class: 'icon-btn', 'aria-label': 'Previous', onclick: () => show((idx + items.length - 1) % items.length) }, '‹'), h('span', { class: 'small' }, `${i + 1} / ${items.length}${it.k === 'floorplan' ? ' · floor plan' : ''}`), h('button', { class: 'icon-btn', 'aria-label': 'Next', onclick: () => show((idx + 1) % items.length) }, '›')) : null); };
    items.forEach((it, i) => thumbs.append(it.t === 'img' ? h('img', { src: mediaUrl(it.id), alt: '', loading: 'lazy', onclick: () => show(i) }) : h('div', { class: 'vthumb', onclick: () => show(i) }, '▶ video')));
    if (items.length) show(0);
    const url = location.origin + '/#/listing/' + l.id; const title = `${l.type} in ${l.town} - KES ${l.rent.toLocaleString()}/month`;
    const heart = h('button', { class: 'btn line', onclick: () => { toggle(favs, l.id); heart.textContent = favs.get().includes(l.id) ? '♥ Saved' : '♡ Save'; } }, favs.get().includes(l.id) ? '♥ Saved' : '♡ Save');
    const cbtn = h('button', { class: 'btn line', onclick: () => { const a = toggle(cmp, l.id, 3); cbtn.textContent = a.includes(l.id) ? '✓ In compare' : '+ Compare'; } }, cmp.get().includes(l.id) ? '✓ In compare' : '+ Compare');
    const tour = l.tourUrl ? embed(l.tourUrl) : null;
    const node = h('div', { class: 'stack' }, h('a', { href: '#/find', class: 'small' }, '← All homes'),
      h('div', { class: 'grid g2 listing-top' }, h('div', null, items.length ? hero : card(empty('The landlord has not added photos yet. Book a viewing to see the house.', 'building')), thumbs),
        card(h('div', { class: 'row between' }, h('h1', null, `${l.type}${l.bedrooms ? ' · ' + l.bedrooms + ' bed' : ''}`), NH.badge('Verified', 'ok')), h('div', { class: 'blue bold', style: { fontSize: '1.8rem' } }, money(l.rent), h('span', { class: 'small muted' }, ' / month')),
          h('p', null, `Deposit ${money(l.deposit)}${l.availableFrom ? ' · Available from ' + fdate(l.availableFrom) : ' · Available now'}`), h('p', { class: 'muted' }, `${l.property}, ${l.town}, ${l.county}`),
          h('div', null, l.bathrooms ? h('span', { class: 'chip' }, l.bathrooms + ' bathroom(s)') : null, l.furnished ? h('span', { class: 'chip' }, 'Furnished') : null, l.floor ? h('span', { class: 'chip' }, 'Floor ' + l.floor) : null, ...(l.amenities || []).map((a) => h('span', { class: 'chip' }, a))),
          h('div', { class: 'row', style: { marginTop: '.8rem' } }, h('button', { class: 'btn red lg', onclick: () => bookViewing(l) }, '📅 Book a viewing'), h('button', { class: 'btn ghost', onclick: () => enquire(l) }, 'Call me back')),
          h('div', { class: 'row', style: { marginTop: '.5rem' } }, heart, cbtn, h('a', { class: 'btn line', href: 'https://wa.me/?text=' + encodeURIComponent(title + ' ' + url), target: '_blank', rel: 'noopener' }, 'Share on WhatsApp'), h('button', { class: 'btn line', onclick: () => { navigator.clipboard && navigator.clipboard.writeText(url); toast('Link copied', 'ok'); } }, 'Copy link')))));
    node.append(card(h('h2', null, 'About this house'), h('p', null, l.description || 'No description yet.'), l.propertyDescription ? h('p', { class: 'muted' }, l.propertyDescription) : null, l.rules ? h('p', { class: 'small muted' }, 'House rules: ' + l.rules) : null, h('p', { class: 'small' }, h('a', { href: 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(`${l.property} ${l.town} ${l.county} Kenya`), target: '_blank', rel: 'noopener' }, '📍 See the area on a map'), ' · The exact address is shared when your viewing is confirmed.')));
    if (l.tourUrl) node.append(card(h('h2', null, 'Virtual tour'), tour ? h('div', { class: 'embed' }, h('iframe', { src: tour, allowfullscreen: true, loading: 'lazy', referrerpolicy: 'no-referrer', title: 'Virtual tour' })) : h('a', { class: 'btn', href: l.tourUrl, target: '_blank', rel: 'noopener noreferrer' }, 'Open the virtual tour')));
    return node;
  }, { auth: false, title: 'House' });
  function enquire(l) {
    const name = h('input', { type: 'text', placeholder: 'Your name' }), ph = h('input', { type: 'tel', placeholder: '0712 345 678' }), msg = h('textarea', { placeholder: 'Message (optional)' }), hp = h('input', { type: 'text', style: { display: 'none' }, tabindex: '-1', autocomplete: 'off' });
    modal('Request a call', h('div', { class: 'stack' }, field('Your name', name), field('Phone', ph), field('Message', msg), hp), { actions: (close) => [h('button', { class: 'btn line', onclick: close }, 'Close'), h('button', { class: 'btn red', onclick: (e) => busy(e.currentTarget, async () => { const r = await NH.api('POST', '/api/public/inquiry', { unitId: l.id, name: name.value, phone: ph.value, message: msg.value, website: hp.value }, { quiet: true }); toast(r.message || 'Sent', 'ok'); close(); }) }, 'Send')] });
  }
  function bookViewing(l) {
    const today = new Date(Date.now() + 3 * 3600e3); const iso = (d) => d.toISOString().slice(0, 10);
    const date = h('input', { type: 'date', min: iso(today), max: iso(new Date(today.getTime() + 30 * 864e5)), value: iso(new Date(today.getTime() + 864e5)) });
    const slot = h('select', null, [['morning', 'Morning (8am–12pm)'], ['afternoon', 'Afternoon (12–5pm)'], ['evening', 'Evening (5–7pm)']].map(([v, t]) => h('option', { value: v }, t)));
    const name = h('input', { type: 'text', placeholder: 'Your name' }), ph = h('input', { type: 'tel', placeholder: '0712 345 678' }), msg = h('input', { type: 'text', placeholder: 'Anything to ask? (optional)', maxlength: 300 }), hp = h('input', { type: 'text', style: { display: 'none' }, tabindex: '-1', autocomplete: 'off' }); const cons = h('input', { type: 'checkbox' });
    modal('Book a viewing', h('div', { class: 'stack' }, note('', 'Free. The landlord or agent confirms the time by SMS. The exact address is shown once confirmed.'), h('div', { class: 'form-grid' }, field('Day', date), field('Time of day', slot), field('Your name', name), field('Phone', ph)), field('Message', msg), hp, h('label', { class: 'chk small' }, cons, h('span', null, 'I agree that the landlord or agent may contact me about this viewing and store my details, as described in the ', h('a', { href: '#/privacy', target: '_blank' }, 'Privacy Notice'), '.'))), { actions: (close) => [h('button', { class: 'btn line', onclick: close }, 'Cancel'), h('button', { class: 'btn red', onclick: (e) => busy(e.currentTarget, async () => { const r = await NH.api('POST', '/api/public/viewings', { consent: cons.checked, unitId: l.id, name: name.value, phone: ph.value, date: date.value, slot: slot.value, message: msg.value, website: hp.value }, { quiet: true }); close(); modal('Request sent', h('div', { class: 'stack' }, note('ok', r.message), h('a', { class: 'btn', href: '#/track/' + r.token, onclick: () => document.querySelector('.overlay') && document.querySelector('.overlay').remove() }, 'Track my request'), h('p', { class: 'small muted' }, 'Bookmark the tracking page to see the reply.')), { actions: (c2) => [h('button', { class: 'btn', onclick: c2 }, 'Done')] }); }) }, 'Request viewing')] });
  }
  route('/track/:t', async (p) => {
    const { viewing: v } = await NH.api('GET', '/api/public/viewings/' + p.t, undefined, { quiet: true });
    const label = { requested: ['Waiting for the landlord', 'warn'], confirmed: ['Confirmed', 'ok'], declined: ['Not possible - request another day', 'bad'], done: ['Completed', 'gray'], no_show: ['Marked as missed', 'bad'] }[v.status];
    return card(h('h2', null, 'Your viewing request'), h('p', null, v.house), h('p', null, `${fdate(v.date)} · ${v.slot}${v.time ? ' at ' + v.time : ''}`), NH.badge(label[0], label[1]), v.address ? h('p', null, h('b', null, 'Address: '), v.address) : null, v.note ? h('p', { class: 'muted' }, v.note) : null, h('a', { href: '#/find' }, '← Back to homes'));
  }, { auth: false, title: 'Viewing' });
  route('/alert-stop/:t', async (p) => { await NH.api('GET', '/api/public/alerts/stop/' + p.t, undefined, { quiet: true }); return card(h('h2', null, 'Alert stopped'), h('p', null, 'You will not get more texts for that search.'), h('a', { href: '#/find' }, 'Back to homes')); }, { auth: false, title: 'Alert' });

  /* ---- saved & compare ---- */
  async function loadMany(ids) { const out = []; for (const id of ids) { try { out.push((await NH.api('GET', '/api/public/listings/' + id, undefined, { quiet: true })).listing); } catch { /* no longer available */ } } return out; }
  route('/saved', async () => { const rows = await loadMany(favs.get()); return h('div', { class: 'stack' }, h('a', { href: '#/find', class: 'small' }, '← All homes'), pageHead('Saved homes'), rows.length ? h('div', { class: 'grid auto' }, rows.map(listingCard)) : card(empty('Tap ♥ on a house to save it here. Saved on this phone only.', 'search'))); }, { auth: false, title: 'Saved' });
  route('/compare', async () => {
    const rows = await loadMany(cmp.get()); if (!rows.length) return h('div', { class: 'stack' }, h('a', { href: '#/find', class: 'small' }, '← All homes'), card(empty('Open a house and press "+ Compare" (up to 3).', 'search')));
    const r = (label, f) => ({ label, f }); const lines = [r('Photo', (l) => { const c = l.media.find((m) => m.kind === 'photo'); return c ? h('img', { src: mediaUrl(c.id), style: { width: '100%', maxWidth: '220px', borderRadius: '10px' } }) : '-'; }), r('Rent / month', (l) => h('b', null, money(l.rent))), r('Deposit', (l) => money(l.deposit)), r('Type', (l) => l.type), r('Bedrooms', (l) => l.bedrooms || '-'), r('Bathrooms', (l) => l.bathrooms || '-'), r('Furnished', (l) => (l.furnished ? 'Yes' : 'No')), r('Area', (l) => `${l.town}, ${l.county}`), r('Available', (l) => (l.availableFrom ? fdate(l.availableFrom) : 'Now')), r('Amenities', (l) => (l.amenities || []).join(', ') || '-'), r('Video / tour', (l) => [l.media.some((m) => m.kind === 'video') ? 'Video' : '', l.tourUrl ? '360° tour' : ''].filter(Boolean).join(' + ') || '-'), r('', (l) => h('div', { class: 'row' }, h('a', { class: 'btn sm', href: '#/listing/' + l.id }, 'Open'), h('button', { class: 'btn sm line', onclick: () => { toggle(cmp, l.id); NH.refresh(); } }, 'Remove')))];
    return h('div', { class: 'stack' }, h('a', { href: '#/find', class: 'small' }, '← All homes'), pageHead('Compare homes'), card(h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'tbl' }, h('tbody', null, lines.map((x) => h('tr', null, h('th', null, x.label), ...rows.map((l) => h('td', null, x.f(l)))))))))); }, { auth: false, title: 'Compare' });

  /* ---- rental passport (public view for landlords screening an applicant) ---- */
  route('/passport/:t', async (p) => {
    const d = await NH.api('GET', '/api/public/passport/' + p.t, undefined, { quiet: true }); const x = d.passport; const col = { Excellent: 'ok', Good: 'ok', Fair: 'warn', 'Needs attention': 'bad', 'New tenant': 'gray' }[x.grade];
    return h('div', { class: 'stack', style: { maxWidth: '640px', margin: '0 auto' } }, card(h('div', { class: 'row between' }, h('h1', null, 'Rental passport'), NH.badge('Verified by Jasmyle Properties', 'ok')), h('h2', null, x.name), NH.badge(x.grade, col),
      h('div', { class: 'grid g2', style: { marginTop: '.8rem' } }, stat('Paid on time', x.onTimeRate === null ? '-' : x.onTimeRate + '%', `${x.paidOnTime} on time, ${x.paidLate} late`, x.onTimeRate >= 90 ? 'blue' : 'red'), stat('Months rented', x.monthsRented, x.since ? 'since ' + fdate(x.since) : 'no history yet'), stat('Rent months recorded', x.rentMonthsRecorded, 'through Jasmyle Properties'), stat('Unpaid right now', x.unpaidNow, x.currentlyRenting ? 'currently renting' : 'not renting now', x.unpaidNow ? 'red' : '')),
      h('p', { class: 'small muted' }, 'Calculated from rent payments recorded in Jasmyle Properties. The tenant chose to share this; the link expires ' + fdate(d.validUntil) + '. No ID number, phone or address is shown.')));
  }, { auth: false, title: 'Rental passport' });
  (NH.accountExtras = NH.accountExtras || []).push(() => {
    if (!NH.user || NH.user.role !== 'tenant') return h('div', { class: 'hide' });
    const box = card(h('h2', null, 'Rental passport')); const body = h('div'); box.append(h('p', { class: 'muted small' }, 'Your on-time rent record, shareable with a new landlord so they can trust you faster. You decide who gets it and for how long.'), body);
    NH.get('/api/me/passport').then((d) => { const x = d.preview; body.append(h('p', null, h('b', null, x.grade), x.onTimeRate !== null ? ` · ${x.onTimeRate}% on time over ${x.rentMonthsRecorded} month(s)` : ' · no rent history yet'));
      const days = h('select', null, [[7, '7 days'], [14, '14 days'], [30, '30 days'], [90, '90 days']].map(([v, t]) => h('option', { value: v, selected: v === 14 }, t)));
      body.append(h('div', { class: 'row' }, days, h('button', { class: 'btn', onclick: (e) => busy(e.currentTarget, async () => { const r = await NH.post('/api/me/passport', { days: Number(days.value) }); const link = location.origin + r.url; navigator.clipboard && navigator.clipboard.writeText(link); modal('Passport link', h('div', { class: 'stack' }, note('ok', 'Copied. Send it to the landlord by WhatsApp or SMS.'), h('code', { style: { wordBreak: 'break-all' } }, link), h('p', { class: 'small muted' }, 'Valid until ' + fdate(r.exp) + '. You can cancel it any time.')), { actions: (c) => [h('button', { class: 'btn', onclick: () => { c(); NH.refresh(); } }, 'Done')] }); }) }, 'Create a share link')));
      for (const l of d.links) body.append(h('div', { class: 'row between small' }, h('span', null, 'Link valid until ' + fdate(l.exp)), h('button', { class: 'btn sm red', onclick: (e) => busy(e.currentTarget, async () => { await NH.del('/api/me/passport/' + l.id); NH.refresh(); }) }, 'Cancel link'))); });
    return box;
  });
  (NH.accountExtras).push(() => (NH.user && ['landlord', 'national_admin', 'property_manager'].includes(NH.user.role) ? card(h('h2', null, 'For developers'), h('p', { class: 'muted small' }, 'Every endpoint with its permission, role limit and rate limit.'), h('a', { class: 'btn ghost', href: '/docs.html', target: '_blank', rel: 'noopener' }, 'Open the API reference')) : h('div', { class: 'hide' })));

  /* ---- staff: viewings inbox ---- */
  route('/viewings', async () => {
    const d = await NH.get('/api/viewings'); const canAct = NH.can('unit.write');
    const respond = (v, status) => { const time = h('input', { type: 'time', value: '10:00' }), nt = h('input', { type: 'text', placeholder: 'e.g. Meet at the main gate', maxlength: 200 });
      if (status !== 'confirmed' && status !== 'declined') return busy(null, async () => { await NH.post(`/api/viewings/${v.id}/respond`, { status }); NH.refresh(); });
      modal(status === 'confirmed' ? 'Confirm viewing' : 'Decline viewing', h('div', { class: 'stack' }, status === 'confirmed' ? field('Time you will meet ' + v.name, time) : null, field('Message to the visitor (optional)', nt)), { actions: (close) => [h('button', { class: 'btn line', onclick: close }, 'Cancel'), h('button', { class: 'btn' + (status === 'declined' ? ' red' : ''), onclick: (e) => busy(e.currentTarget, async () => { await NH.post(`/api/viewings/${v.id}/respond`, { status, time: status === 'confirmed' ? time.value : undefined, note: nt.value }); close(); toast('Visitor notified by SMS', 'ok'); NH.refresh(); }) }, status === 'confirmed' ? 'Confirm & text visitor' : 'Decline') ] }); };
    const up = d.viewings.filter((v) => ['requested', 'confirmed'].includes(v.status));
    return h('div', { class: 'stack' }, pageHead('Viewing requests'), h('div', { class: 'grid g4' }, stat('Waiting for reply', d.viewings.filter((v) => v.status === 'requested').length, 'answer within a day', 'red'), stat('Confirmed', d.viewings.filter((v) => v.status === 'confirmed').length, 'upcoming'), stat('Completed', d.viewings.filter((v) => v.status === 'done').length), stat('No-shows', d.viewings.filter((v) => v.status === 'no_show').length)),
      card(h('h2', null, 'Upcoming'), table([{ h: 'Visitor', c: (v) => h('div', null, h('b', null, v.name), h('div', { class: 'small muted' }, NH.phone(v.phone)), v.repeatNoShows ? h('span', { class: 'badge bad' }, v.repeatNoShows + ' past no-show') : null) }, { h: 'House', c: (v) => `${v.unitName} · ${v.propertyName}` }, { h: 'When', c: (v) => `${fdate(v.date)} ${v.slot}${v.time ? ' ' + v.time : ''}` }, { h: 'Status', c: (v) => NH.badge(v.status === 'requested' ? 'Waiting' : 'Confirmed', v.status === 'requested' ? 'warn' : 'ok') }, { h: '', c: (v) => (!canAct ? '' : v.status === 'requested' ? h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => respond(v, 'confirmed') }, 'Confirm'), h('button', { class: 'btn sm line', onclick: () => respond(v, 'declined') }, 'Decline')) : h('div', { class: 'row' }, h('button', { class: 'btn sm ghost', onclick: () => respond(v, 'done') }, 'Done'), h('button', { class: 'btn sm line red', onclick: () => respond(v, 'no_show') }, 'No-show'))) }], up, { empty: 'No viewing requests', icon: 'clip' })),
      v_msgs(d.viewings));
  }, { title: 'Viewings' });
  const v_msgs = (rows) => { const m = rows.filter((v) => v.message && ['requested', 'confirmed'].includes(v.status)); return m.length ? card(h('h3', null, 'Questions from visitors'), h('ul', { class: 'clean' }, m.map((v) => h('li', null, h('b', null, v.name + ': '), v.message)))) : h('div', { class: 'hide' }); };

  /* ---- landlord: photos & videos of a unit ---- */
  async function shrink(file) {
    if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400 * 1024) return file;
    try { const bmp = await createImageBitmap(file); const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height)); const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k); c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.82)); return blob && blob.size < file.size ? blob : file; } catch { return file; }
  }
  NH.listingMedia = async function (unit) {
    const body = h('div', { class: 'stack' }); const grid = h('div', { class: 'media-grid' }); const input = h('input', { type: 'file', accept: 'image/*,video/mp4,video/webm,video/quicktime', multiple: true, class: 'file' }); const tag = h('select', null, [['photo', 'Photos / videos'], ['floorplan', 'Floor plan']].map(([v, t]) => h('option', { value: v }, t)));
    const status = h('p', { class: 'small muted' });
    async function paint() { const d = await NH.get(`/api/files?refType=listing&refId=${unit.id}`); const cover = (await NH.get('/api/units/' + unit.id).catch(() => ({ unit }))).unit || unit; NH.clear(grid);
      if (!d.files.length) grid.append(empty('No photos yet. Houses with photos and video get many more viewings.', 'building'));
      for (const f of d.files) grid.append(h('div', { class: 'mitem' }, f.mime.startsWith('video/') ? h('video', { src: '/api/files/' + f.id, controls: true, preload: 'metadata' }) : h('img', { src: '/api/files/' + f.id, alt: f.name, loading: 'lazy' }), h('div', { class: 'row between small' }, f.tag === 'floorplan' ? NH.badge('Floor plan', '') : cover.coverFileId === f.id ? NH.badge('Cover', 'ok') : (f.mime.startsWith('image/') ? h('button', { class: 'btn sm ghost', onclick: (e) => busy(e.currentTarget, async () => { await NH.put('/api/units/' + unit.id, { name: cover.name, rent: cover.rent, coverFileId: f.id, listed: cover.listed, version: (await NH.get('/api/units/' + unit.id)).unit.version }); paint(); }) }, 'Make cover') : h('span')), h('button', { class: 'btn sm line red', onclick: (e) => busy(e.currentTarget, async () => { if (await confirmBox('Remove this file?', '', 'Remove', true)) { await NH.del('/api/files/' + f.id); paint(); } }) }, 'Remove')))); }
    body.append(note('', 'Show the whole house: living room, bedrooms, kitchen, bathroom, compound, and a short walk-through video (up to 40 MB). Photos are shrunk automatically to save data. They show in public search only while the property is verified and the unit is listed.'), grid, h('div', { class: 'row' }, h('div', null, tag), h('div', { class: 'grow' }, input)), status);
    input.addEventListener('change', async () => { const files = [...input.files]; for (let i = 0; i < files.length; i++) { status.textContent = `Uploading ${i + 1} of ${files.length}...`; try { const f = await shrink(files[i]); await NH.api('POST', `/api/files?refType=listing&refId=${unit.id}&tag=${tag.value}&name=${encodeURIComponent(files[i].name)}`, f, { raw: true }); } catch (e) { toast(files[i].name + ': ' + e.message, 'bad'); } } input.value = ''; status.textContent = ''; paint(); });
    await paint(); modal('Photos & videos - ' + unit.name, body, { wide: true, actions: (close) => [h('button', { class: 'btn', onclick: () => { close(); NH.refresh(); } }, 'Done')] });
  };
})();
