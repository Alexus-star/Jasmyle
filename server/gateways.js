'use strict';
// External payment & SMS providers: Safaricom Daraja (M-Pesa STK Push), PayPal Orders v2 (PayPal + cards), Africa's Talking SMS.
// Secrets are stored encrypted in the database and are decrypted only at the moment of use.
const sec = require('./sec');
const rules = require('./rules');
const { E, log } = require('./util');

const TIMEOUT = 20000;
async function http(url, { method = 'GET', headers = {}, body, form } = {}) {
  const init = { method, headers: { ...headers }, signal: AbortSignal.timeout(TIMEOUT) };
  if (form) { init.body = new URLSearchParams(form).toString(); init.headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  else if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  let r;
  try { r = await fetch(url, init); } catch (e) {
    throw E.unavailable('Could not reach the payment provider. Check the internet connection and try again.');
  }
  const text = await r.text();
  let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text.slice(0, 300) }; }
  return { status: r.status, ok: r.ok, data };
}

/* ======================= M-PESA (Daraja) ======================= */
const tokenCache = new Map();
const mpesaCfg = () => rules.get('integrations.mpesa', {});
const mpesaBase = (s) => (s.env === 'production' ? mpesaCfg().production : mpesaCfg().sandbox);
function mpesaReady(s) { return !!(s && s.enabled && s.shortcode && s.consumerKeyEnc && s.consumerSecretEnc && s.passkeyEnc); }

async function mpesaToken(s) {
  const key = sec.decField(s.consumerKeyEnc), secret = sec.decField(s.consumerSecretEnc);
  const ck = s.env + ':' + key;
  const c = tokenCache.get(ck);
  if (c && c.exp > Date.now()) return c.token;
  const r = await http(mpesaBase(s) + mpesaCfg().tokenPath, { headers: { Authorization: 'Basic ' + Buffer.from(key + ':' + secret).toString('base64') } });
  if (!r.ok || !r.data.access_token) throw E.unavailable('M-Pesa rejected the saved credentials. Ask the landlord to re-check the Consumer Key and Secret.');
  tokenCache.set(ck, { token: r.data.access_token, exp: Date.now() + 50 * 60000 });
  return r.data.access_token;
}
const eatStamp = () => new Date(Date.now() + 3 * 3600e3).toISOString().replace(/[-:T]/g, '').slice(0, 14);
function mpesaPassword(s, ts) { return Buffer.from(String(s.shortcode) + sec.decField(s.passkeyEnc) + ts).toString('base64'); }

async function mpesaStkPush(s, { phone, amount, reference, description, callbackUrl }) {
  const token = await mpesaToken(s);
  const ts = eatStamp();
  const r = await http(mpesaBase(s) + mpesaCfg().stkPath, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token },
    body: {
      BusinessShortCode: s.shortcode, Password: mpesaPassword(s, ts), Timestamp: ts,
      TransactionType: s.type === 'till' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
      Amount: Math.ceil(amount), PartyA: phone, PartyB: s.partyB || s.shortcode, PhoneNumber: phone,
      CallBackURL: callbackUrl, AccountReference: String(reference).slice(0, 12), TransactionDesc: String(description).slice(0, 13),
    },
  });
  if (!r.ok || String(r.data.ResponseCode) !== '0') {
    log('warn', 'M-Pesa STK push rejected', { status: r.status, data: r.data });
    throw E.unavailable('M-Pesa could not start the payment: ' + (r.data.errorMessage || r.data.ResponseDescription || 'please try again'));
  }
  return { checkoutRequestId: r.data.CheckoutRequestID, merchantRequestId: r.data.MerchantRequestID };
}
async function mpesaStkQuery(s, checkoutRequestId) {
  const token = await mpesaToken(s);
  const ts = eatStamp();
  const r = await http(mpesaBase(s) + mpesaCfg().stkQueryPath, {
    method: 'POST', headers: { Authorization: 'Bearer ' + token },
    body: { BusinessShortCode: s.shortcode, Password: mpesaPassword(s, ts), Timestamp: ts, CheckoutRequestID: checkoutRequestId },
  });
  // Daraja returns HTTP 500 with errorCode while the customer is still deciding - treat as "not final yet"
  if (r.data && r.data.ResultCode !== undefined) return { final: true, code: Number(r.data.ResultCode), desc: r.data.ResultDesc };
  return { final: false };
}
/** Parse the callback Safaricom POSTs to us */
function parseMpesaCallback(body) {
  const cb = body && body.Body && body.Body.stkCallback;
  if (!cb) return null;
  const items = (cb.CallbackMetadata && cb.CallbackMetadata.Item) || [];
  const get = (n) => { const i = items.find((x) => x.Name === n); return i ? i.Value : undefined; };
  return {
    checkoutRequestId: cb.CheckoutRequestID, merchantRequestId: cb.MerchantRequestID, code: Number(cb.ResultCode), desc: cb.ResultDesc,
    amount: get('Amount') !== undefined ? Number(get('Amount')) : undefined, receipt: get('MpesaReceiptNumber'), phone: get('PhoneNumber') !== undefined ? String(get('PhoneNumber')) : undefined,
  };
}

/* ======================= PAYPAL (PayPal + debit/credit cards) ======================= */
const ppBase = (s) => rules.get('integrations.paypal.' + (s.mode === 'live' ? 'live' : 'sandbox'));
const paypalReady = (s) => !!(s && s.enabled && s.clientIdEnc && s.secretEnc);
async function ppToken(s) {
  const id = sec.decField(s.clientIdEnc), secret = sec.decField(s.secretEnc);
  const ck = 'pp:' + s.mode + ':' + id;
  const c = tokenCache.get(ck);
  if (c && c.exp > Date.now()) return c.token;
  const r = await http(ppBase(s) + '/v1/oauth2/token', { method: 'POST', headers: { Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64') }, form: { grant_type: 'client_credentials' } });
  if (!r.ok || !r.data.access_token) throw E.unavailable('PayPal rejected the saved credentials. Ask the landlord to re-check the Client ID and Secret.');
  tokenCache.set(ck, { token: r.data.access_token, exp: Date.now() + Math.max(60, (r.data.expires_in || 600) - 120) * 1000 });
  return r.data.access_token;
}
async function paypalCreateOrder(s, { paymentId, usd, description, returnUrl, cancelUrl }) {
  const token = await ppToken(s);
  const r = await http(ppBase(s) + '/v2/checkout/orders', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'PayPal-Request-Id': paymentId },
    body: {
      intent: 'CAPTURE',
      purchase_units: [{ reference_id: paymentId, custom_id: paymentId, description: String(description).slice(0, 120), amount: { currency_code: 'USD', value: usd.toFixed(2) } }],
      payment_source: { paypal: { experience_context: { return_url: returnUrl, cancel_url: cancelUrl, user_action: 'PAY_NOW', shipping_preference: 'NO_SHIPPING', landing_page: 'NO_PREFERENCE' } } },
    },
  });
  if (!r.ok || !r.data.id) { log('warn', 'PayPal create order failed', { status: r.status, data: r.data }); throw E.unavailable('PayPal could not start the payment. Please try again.'); }
  const link = (r.data.links || []).find((l) => l.rel === 'payer-action' || l.rel === 'approve');
  if (!link) throw E.unavailable('PayPal did not return a payment page.');
  return { orderId: r.data.id, approveUrl: link.href };
}
async function paypalCapture(s, orderId) {
  const token = await ppToken(s);
  const r = await http(ppBase(s) + `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'PayPal-Request-Id': 'cap-' + orderId }, body: {} });
  const d = r.data || {};
  const cap = d.purchase_units && d.purchase_units[0] && d.purchase_units[0].payments && d.purchase_units[0].payments.captures && d.purchase_units[0].payments.captures[0];
  if ((r.ok || (d.details && d.details.some((x) => x.issue === 'ORDER_ALREADY_CAPTURED'))) && d.status === 'COMPLETED' && cap && cap.status === 'COMPLETED') {
    return { ok: true, captureId: cap.id, usd: Number(cap.amount.value), currency: cap.amount.currency_code, customId: d.purchase_units[0].custom_id || d.purchase_units[0].reference_id };
  }
  if (d.details && d.details.some((x) => x.issue === 'ORDER_ALREADY_CAPTURED')) { // fetch the order instead
    const o = await http(ppBase(s) + `/v2/checkout/orders/${encodeURIComponent(orderId)}`, { headers: { Authorization: 'Bearer ' + token } });
    const c2 = o.data.purchase_units && o.data.purchase_units[0].payments && o.data.purchase_units[0].payments.captures && o.data.purchase_units[0].payments.captures[0];
    if (o.data.status === 'COMPLETED' && c2) return { ok: true, captureId: c2.id, usd: Number(c2.amount.value), currency: c2.amount.currency_code, customId: o.data.purchase_units[0].custom_id };
  }
  return { ok: false, reason: (d.message || d.name || 'not completed') };
}

/* ======================= SMS (Africa's Talking) ======================= */
async function sendSms(s, phone, message) {
  if (!s || !s.enabled || !s.apiKeyEnc || !s.username) return false;
  try {
    const host = s.username === 'sandbox' ? 'api.sandbox.africastalking.com' : 'api.africastalking.com';
    const form = { username: s.username, to: '+' + phone, message: String(message).slice(0, 300) };
    if (s.senderId) form.from = s.senderId;
    const r = await http(`https://${host}/version1/messaging`, { method: 'POST', headers: { apiKey: sec.decField(s.apiKeyEnc), Accept: 'application/json' }, form });
    return r.ok;
  } catch (e) { log('warn', 'SMS failed: ' + e.message); return false; }
}

module.exports = { http, mpesaReady, mpesaToken, mpesaStkPush, mpesaStkQuery, parseMpesaCallback, paypalReady, ppToken, paypalCreateOrder, paypalCapture, sendSms };
