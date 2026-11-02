'use strict';
// Tiny self-contained QR code generator (byte mode, error-correction level M, versions 1-10).
// Used to show the two-factor setup code so a phone can scan it. No internet or libraries needed.
//   NH_QR.svg('otpauth://...', { size: 220 })  -> SVG markup string
(function () {
  // [ecCodewordsPerBlock, [[blocks, dataCodewordsPerBlock], ...]] for level M, versions 1..10
  const EC_M = [null,
    [10, [[1, 16]]], [16, [[1, 28]]], [26, [[1, 44]]], [18, [[2, 32]]], [24, [[2, 43]]],
    [16, [[4, 27]]], [18, [[4, 31]]], [22, [[2, 38], [2, 39]]], [22, [[3, 36], [2, 37]]], [26, [[4, 43], [1, 44]]]];
  const ALIGN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

  // GF(256) arithmetic
  const EXP = new Array(512); const LOG = new Array(256);
  (function () { let x = 1; for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 256) x ^= 0x11d; } for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]; })();
  const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);
  function rsGenerator(n) { let g = [1]; for (let i = 0; i < n; i++) { const next = new Array(g.length + 1).fill(0); for (let j = 0; j < g.length; j++) { next[j] ^= g[j]; next[j + 1] ^= gmul(g[j], EXP[i]); } g = next; } return g; }
  function rsRemainder(data, n) {
    const gen = rsGenerator(n); const res = new Array(n).fill(0);
    for (const b of data) { const f = b ^ res.shift(); res.push(0); for (let i = 0; i < n; i++) res[i] ^= gmul(gen[i + 1], f); }
    return res;
  }
  const dataCap = (v) => EC_M[v][1].reduce((a, [n, d]) => a + n * d, 0);

  function utf8(str) { return Array.from(new TextEncoder().encode(str)); }

  function buildCodewords(bytes, v) {
    const bits = [];
    const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    put(4, 4); put(bytes.length, v <= 9 ? 8 : 16);
    for (const b of bytes) put(b, 8);
    const cap = dataCap(v) * 8;
    put(0, Math.min(4, cap - bits.length));
    while (bits.length % 8) bits.push(0);
    const data = [];
    for (let i = 0; i < bits.length; i += 8) { let b = 0; for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]; data.push(b); }
    for (let pad = 0xec; data.length < dataCap(v); pad ^= 0xec ^ 0x11) data.push(pad);
    // split into blocks, add error correction, interleave
    const [ecLen, groups] = EC_M[v]; const blocks = []; let pos = 0;
    for (const [n, d] of groups) for (let i = 0; i < n; i++) { const chunk = data.slice(pos, pos + d); pos += d; blocks.push({ data: chunk, ec: rsRemainder(chunk, ecLen) }); }
    const out = []; const maxD = Math.max(...blocks.map((b) => b.data.length));
    for (let i = 0; i < maxD; i++) for (const b of blocks) if (i < b.data.length) out.push(b.data[i]);
    for (let i = 0; i < ecLen; i++) for (const b of blocks) out.push(b.ec[i]);
    return out;
  }

  function formatBits(mask) { const data = (0 << 3) | mask; /* level M = 00 */ let rem = data << 10; for (let i = 14; i >= 10; i--) if ((rem >>> i) & 1) rem ^= 0x537 << (i - 10); return ((data << 10) | rem) ^ 0x5412; }
  function versionBits(v) { let rem = v << 12; for (let i = 17; i >= 12; i--) if ((rem >>> i) & 1) rem ^= 0x1f25 << (i - 12); return (v << 12) | rem; }

  const MASKS = [(r, c) => (r + c) % 2 === 0, (r) => r % 2 === 0, (r, c) => c % 3 === 0, (r, c) => (r + c) % 3 === 0, (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0, (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0];

  function makeMatrix(v, codewords, mask) {
    const n = 17 + 4 * v;
    const m = Array.from({ length: n }, () => new Array(n).fill(false));
    const fn = Array.from({ length: n }, () => new Array(n).fill(false));
    const set = (r, c, val) => { if (r >= 0 && c >= 0 && r < n && c < n) { m[r][c] = val; fn[r][c] = true; } };
    const finder = (r0, c0) => { for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) { const on = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 && (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4)); set(r0 + dr, c0 + dc, on); } };
    finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
    for (let i = 8; i < n - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    const al = ALIGN[v];
    for (const r of al) for (const c of al) {
      if ((r === 6 && c === 6) || (r === 6 && c === al[al.length - 1]) || (r === al[al.length - 1] && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
    // reserve format + version areas, dark module
    for (let i = 0; i < 9; i++) { if (i !== 6) { set(8, i, false); set(i, 8, false); } }
    for (let i = 0; i < 8; i++) { set(8, n - 1 - i, false); set(n - 1 - i, 8, false); }
    set(n - 8, 8, true);
    if (v >= 7) { const vb = versionBits(v); for (let i = 0; i < 18; i++) { const bit = ((vb >>> i) & 1) === 1; const a = Math.floor(i / 3); const b = (i % 3) + n - 11; set(a, b, bit); set(b, a, bit); } }
    // data placement (zig-zag)
    const bits = []; for (const cw of codewords) for (let i = 7; i >= 0; i--) bits.push((cw >>> i) & 1);
    let k = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++) for (let j = 0; j < 2; j++) {
        const c = right - j; const up = ((right + 1) & 2) === 0; const r = up ? n - 1 - vert : vert;
        if (!fn[r][c]) { let bit = k < bits.length ? bits[k] === 1 : false; k++; if (MASKS[mask](r, c)) bit = !bit; m[r][c] = bit; }
      }
    }
    // format information
    const fb = formatBits(mask); const f = (i) => ((fb >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) m[i][8] = f(i);
    m[7][8] = f(6); m[8][8] = f(7); m[8][7] = f(8);
    for (let i = 9; i < 15; i++) m[8][14 - i] = f(i);
    for (let i = 0; i < 8; i++) m[8][n - 1 - i] = f(i);
    for (let i = 8; i < 15; i++) m[n - 15 + i][8] = f(i);
    m[n - 8][8] = true;
    return m;
  }

  function penalty(m) {
    const n = m.length; let p = 0;
    for (let pass = 0; pass < 2; pass++) for (let a = 0; a < n; a++) {
      let run = 1;
      for (let b = 1; b < n; b++) { const cur = pass ? m[b][a] : m[a][b]; const prev = pass ? m[b - 1][a] : m[a][b - 1]; if (cur === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1; }
    }
    for (let r = 0; r < n - 1; r++) for (let c = 0; c < n - 1; c++) if (m[r][c] === m[r][c + 1] && m[r][c] === m[r + 1][c] && m[r][c] === m[r + 1][c + 1]) p += 3;
    const pat = [true, false, true, true, true, false, true];
    for (let a = 0; a < n; a++) { for (let i = 0; i <= n - 7; i++) { if (pat.every((x, j) => m[a][i + j] === x)) p += 40; if (pat.every((x, j) => m[i + j][a] === x)) p += 40; } }
    let dark = 0; for (const row of m) for (const x of row) if (x) dark++;
    p += Math.floor(Math.abs((dark * 100) / (n * n) - 50) / 5) * 10;
    return p;
  }

  function encode(text) {
    const bytes = utf8(text); let v = 1;
    while (v <= 10 && dataCap(v) < bytes.length + (v <= 9 ? 2 : 3)) v++;
    if (v > 10) throw new Error('Text too long for the built-in QR code');
    const cws = buildCodewords(bytes, v);
    let best = null; let bestP = Infinity;
    for (let mask = 0; mask < 8; mask++) { const m = makeMatrix(v, cws, mask); const p = penalty(m); if (p < bestP) { bestP = p; best = m; } }
    return best;
  }
  function svg(text, opts) {
    const o = Object.assign({ size: 220, quiet: 4 }, opts || {}); const m = encode(text); const n = m.length + o.quiet * 2; let d = '';
    for (let r = 0; r < m.length; r++) for (let c = 0; c < m.length; c++) if (m[r][c]) d += `M${c + o.quiet} ${r + o.quiet}h1v1h-1z`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${o.size}" height="${o.size}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }
  const api = { encode, svg };
  if (typeof window !== 'undefined') window.NH_QR = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
