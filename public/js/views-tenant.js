'use strict';
/* Tenant screens: pay rent, receipts, lease. */
(function () {
  const { h, icon, money, fdate, fdt, ago, route } = NH;
  const { card, stat, empty, pageHead, table, toast, modal, busy } = NH.ui;

  route('/pay', async () => {
    NH.title('Pay rent');
    const o = await NH.get('/api/pay/options');
    if (o.balance <= 0) return h('div', { class: 'stack' }, pageHead('Pay rent'), card(empty('You are all paid up. Nothing to pay right now.', 'check')), h('a', { class: 'btn ghost', href: '#/payments' }, 'See my receipts'));
    const node = h('div', { class: 'stack' }); const panel = h('div'); let method = o.mpesa ? 'mpesa' : o.paypal ? 'paypal' : 'bank';
    const amount = h('input', { type: 'number', value: o.balance, min: 10, max: o.balance, step: 'any', style: { fontSize: '1.4rem', fontWeight: 700 } });
    const choices = h('div', { class: 'grid g3' });
    const methods = [['mpesa', 'M-Pesa', 'Pay with your phone (STK Push)', o.mpesa, 'phone'], ['paypal', 'PayPal / Card', 'Visa, Mastercard or PayPal', o.paypal, 'card'], ['bank', 'Bank transfer', 'Pay at the bank, then tell us', !!o.bank, 'building']];
    function paintChoices() { NH.clear(choices); for (const [k, t, s, on, ic] of methods) choices.append(h('button', { class: 'card', disabled: !on, style: { textAlign: 'left', cursor: on ? 'pointer' : 'not-allowed', opacity: on ? 1 : .5, outline: method === k ? '3px solid var(--r6)' : 'none', border: 0 }, onclick: () => { method = k; paintChoices(); paintPanel(); } }, h('div', { class: 'blue' }, icon(ic)), h('b', null, t), h('div', { class: 'small muted' }, on ? s : 'Not available'))); }
    const amt = () => { const v = Number(amount.value); if (!(v >= 10)) throw new Error('Enter an amount of at least KES 10'); if (v > o.balance + 0.001) throw new Error('You only owe ' + money(o.balance)); return v; };
    function paintPanel() {
      NH.clear(panel);
      if (method === 'mpesa') {
        const ph = h('input', { type: 'tel', value: NH.phone(o.phone), placeholder: '0712 345 678' });
        panel.append(card(h('h2', null, 'Pay with M-Pesa'), h('div', { class: 'f' }, h('label', null, 'M-Pesa phone number'), ph, h('div', { class: 'hint' }, 'A prompt will appear on this phone. Enter your M-Pesa PIN to approve.')), h('button', { class: 'btn red lg block', style: { marginTop: '.8rem' }, onclick: (e) => busy(e.currentTarget, async () => { const a = amt(); const r = await NH.post('/api/pay/mpesa', { amount: a, phone: ph.value }); waitFor(r.payment.id, r.message); }) }, icon('phone'), 'Send payment request')));
      } else if (method === 'paypal') {
        const usd = Math.max(0.01, Math.round((Number(amount.value || 0) / o.usdRate) * 100) / 100);
        panel.append(card(h('h2', null, 'Pay with PayPal or card'), h('p', { class: 'muted' }, `You will be taken to a secure PayPal page. Card payers can choose "Pay with Debit or Credit Card". Charged in US dollars at KES ${o.usdRate} per USD (about USD ${usd.toFixed(2)}).`), h('button', { class: 'btn lg block', onclick: (e) => busy(e.currentTarget, async () => { const a = amt(); const r = await NH.post('/api/pay/paypal', { amount: a }); if (r.approveUrl.startsWith('/#/')) location.hash = r.approveUrl.slice(2); else location.href = r.approveUrl; }) }, icon('card'), 'Continue to PayPal')));
      } else {
        const b = o.bank; const ref = h('input', { type: 'text', placeholder: 'e.g. FT26123ABCD', maxlength: 40 });
        panel.append(card(h('h2', null, 'Pay by bank transfer'), h('div', { class: 'note' }, h('div', null, h('b', null, b.bankName || 'Bank'), b.branch ? ' - ' + b.branch : ''), h('div', null, 'Account name: ', h('b', null, b.accountName)), h('div', null, 'Account number: ', h('b', null, b.accountNo)), h('div', null, 'Reference to use: ', h('b', null, b.reference)), b.instructions ? h('div', { class: 'small muted' }, b.instructions) : null),
          h('div', { class: 'f', style: { marginTop: '.8rem' } }, h('label', null, 'After paying, enter the bank transaction reference'), ref, h('div', { class: 'hint' }, 'Your landlord checks the bank statement and confirms. Your balance updates once confirmed.')), h('button', { class: 'btn lg block', style: { marginTop: '.8rem' }, onclick: (e) => busy(e.currentTarget, async () => { const a = amt(); const r = await NH.post('/api/pay/bank', { amount: a, bankRef: ref.value }); NH.clear(panel).append(card(h('div', { class: 'note ok' }, r.message), h('a', { class: 'btn', href: '#/' }, 'Back home'))); }) }, 'I have paid - notify landlord')));
      }
    }
    function waitFor(id, msg) {
      let tries = 0; const box = h('div', { class: 'stack center' }, h('div', { class: 'spin' }), h('h2', null, 'Waiting for your approval...'), h('p', { class: 'muted' }, msg || 'Check your phone and enter your M-Pesa PIN.'));
      NH.clear(panel).append(card(box));
      const tick = async () => {
        if (!document.body.contains(box)) return; tries++;
        try {
          const r = await NH.get('/api/pay/status/' + id); const p = r.payment;
          if (p.status === 'completed') return NH.clear(box).append(h('h2', { class: 'green' }, 'Payment received - thank you!'), h('p', null, `${money(p.amount)} - receipt ${p.receiptNo}`), h('div', { class: 'row', style: { justifyContent: 'center' } }, h('button', { class: 'btn', onclick: () => busy(null, () => NH.receiptModal(p.id)) }, icon('file'), 'View receipt'), h('a', { class: 'btn line', href: '#/' }, 'Back home')));
          if (p.status === 'failed') return NH.clear(box).append(h('h2', { class: 'red' }, 'Payment was not completed'), h('p', { class: 'muted' }, p.failReason || ''), h('button', { class: 'btn', onclick: NH.refresh }, 'Try again'));
        } catch (e) { /* keep waiting */ }
        if (tries > 45) return NH.clear(box).append(h('h2', null, 'Still waiting...'), h('p', { class: 'muted' }, 'If you already approved on your phone, your balance will update shortly. You can leave this page.'), h('a', { class: 'btn', href: '#/' }, 'Back home'));
        setTimeout(tick, 3000);
      };
      setTimeout(tick, 2500);
    }
    node.append(pageHead('Pay rent'), o.simulated ? h('div', { class: 'note bad' }, 'PRACTICE MODE: your landlord has not gone live yet. Payments here are only simulated.') : null, card(h('div', { class: 'row between' }, h('div', null, h('div', { class: 'muted' }, 'You owe'), h('b', { class: 'red', style: { fontSize: '1.6rem' } }, money(o.balance))), h('div', { style: { minWidth: '210px' } }, h('div', { class: 'small muted' }, 'Amount to pay now (KES)'), amount))), h('h2', null, 'Choose how to pay'), choices, panel);
    amount.oninput = () => { if (method === 'paypal') paintPanel(); };
    paintChoices(); paintPanel(); return node;
  }, { title: 'Pay rent' });

  route('/simulated-paypal/:id', async (p) => {
    const r = await NH.get('/api/pay/status/' + p.id);
    return h('div', { class: 'stack', style: { maxWidth: '460px', margin: '2rem auto' } }, card(h('div', { class: 'center stack' }, h('h2', { style: { color: '#003087' } }, 'PayPal (practice)'), h('div', { class: 'note bad' }, 'This is a practice page. No real PayPal account or money is involved.'), h('div', { class: 'val', style: { fontSize: '2rem', fontWeight: 800 } }, money(r.payment.amount)), h('button', { class: 'btn lg block', onclick: (e) => busy(e.currentTarget, async () => { await NH.post('/api/pay/paypal/simulate/' + p.id); NH.go('/pay-result/' + p.id + '?ok=1'); }) }, 'Approve practice payment'), h('a', { href: '#/pay' }, 'Cancel'))));
  }, { title: 'PayPal' });

  route('/pay-result/:id', async (p, q) => {
    let pay = null; try { pay = (await NH.get('/api/pay/status/' + p.id)).payment; } catch { /* ignore */ }
    const ok = pay && (pay.status === 'completed' || pay.status === 'awaiting_confirmation');
    return h('div', { class: 'stack', style: { maxWidth: '520px', margin: '2rem auto' } }, card(h('div', { class: 'center stack' }, ok ? [h('h1', { class: 'green' }, pay.status === 'completed' ? 'Payment received - thank you!' : 'Payment received - under review'), h('p', null, `${money(pay.amount)}${pay.receiptNo ? ' - receipt ' + pay.receiptNo : ''}`), pay.status === 'completed' ? h('button', { class: 'btn', onclick: () => busy(null, () => NH.receiptModal(pay.id)) }, icon('file'), 'View receipt') : null] : [h('h1', { class: 'red' }, 'Payment not completed'), h('p', { class: 'muted' }, (pay && pay.failReason) || 'You were not charged.'), h('a', { class: 'btn', href: '#/pay' }, 'Try again')], h('a', { href: '#/' }, 'Back home'))));
  }, { title: 'Payment' });

  NH.tenantPayments = async function () {
    NH.title('Receipts & history');
    const [pays, invs] = await Promise.all([NH.get('/api/payments'), NH.get('/api/invoices')]);
    const node = h('div', { class: 'stack' }, pageHead('Receipts & history', h('a', { class: 'btn', href: '#/pay' }, icon('card'), 'Pay rent')));
    node.append(card(h('h2', null, 'My payments'), table([{ h: 'Date', c: (x) => fdt(x.paidAt || x.createdAt) }, { h: 'Method', c: (x) => NH.METHOD[x.method] + (x.simulated ? ' (practice)' : '') }, { h: 'Status', c: (x) => NH.stateBadge(x.status) }, { h: 'Amount', cls: 'num', c: (x) => h('b', null, money(x.amount)) }, { h: '', c: (x) => (x.status === 'completed' ? h('button', { class: 'btn sm ghost', onclick: () => busy(null, () => NH.receiptModal(x.id)) }, icon('file'), 'Receipt') : x.failReason ? h('span', { class: 'small muted' }, x.failReason) : '') }], pays.payments, { empty: 'No payments yet', icon: 'card' })));
    node.append(card(h('h2', null, 'My bills'), table([{ h: 'Bill', c: (i) => h('div', null, h('b', null, i.desc), h('div', { class: 'small muted' }, i.number)) }, { h: 'Due', c: (i) => fdate(i.dueDate) }, { h: 'Amount', cls: 'num', c: (i) => money(i.amount) }, { h: 'Balance', cls: 'num', c: (i) => money(i.balance) }, { h: 'Status', c: (i) => NH.stateBadge(i.state) }], invs.invoices, { empty: 'No bills yet', icon: 'file' })));
    return node;
  };

  route('/lease', async () => {
    NH.title('My lease');
    const [d, files] = await Promise.all([NH.get('/api/leases'), NH.get('/api/leases')]);
    const doc = new Map(files.leases.map((l) => [l.id, l.document]));
    return h('div', { class: 'stack' }, pageHead('My lease & rental history'), d.leases.length ? d.leases.map((l) => card(h('div', { class: 'head' }, h('h2', null, `${l.unitName} - ${l.propertyName}`), NH.stateBadge(l.status)), h('div', { class: 'grid g4 small' }, h('div', null, h('div', { class: 'muted' }, 'Monthly rent'), h('b', null, money(l.rent))), h('div', null, h('div', { class: 'muted' }, 'Deposit'), h('b', null, money(l.deposit))), h('div', null, h('div', { class: 'muted' }, 'Rent due on day'), h('b', null, l.dueDay)), h('div', null, h('div', { class: 'muted' }, 'Period'), h('b', null, `${fdate(l.startDate)} → ${l.endDate ? fdate(l.endDate) : 'ongoing'}`))), doc.get(l.id) ? h('a', { class: 'btn ghost', style: { marginTop: '.8rem' }, href: '/api/files/' + doc.get(l.id).id, target: '_blank', rel: 'noopener' }, icon('file'), 'Open my lease agreement') : h('p', { class: 'small muted', style: { marginTop: '.6rem' } }, 'Your signed agreement has not been uploaded yet.'))) : card(empty('No lease on record yet', 'file')));
  }, { title: 'Lease' });
})();
