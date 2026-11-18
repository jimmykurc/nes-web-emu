// Generic (de)serialisation of emulator component state for save states.
// Walks own enumerable properties, copying numbers, booleans, strings and
// typed arrays, and recursing into nested component objects. References
// to other components are skipped by name.

const SKIP = new Set(['nes', 'bus', 'cpu', 'ppu', 'apu', 'mapper', 'cart', 'prgRom', 'frameBuffer', 'sampleBuffer']);

function toBase64(u8) {
  if (typeof Buffer !== 'undefined') return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(str) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(str, 'base64'));
  const s = atob(str);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

export function snapshot(obj, skip = []) {
  const out = {};
  for (const key of Object.keys(obj)) {
    if (SKIP.has(key) || skip.includes(key)) continue;
    const v = obj[key];
    const t = typeof v;
    if (t === 'number' || t === 'boolean' || t === 'string' || v === null) {
      out[key] = v;
    } else if (ArrayBuffer.isView(v)) {
      out[key] = { $t: v.constructor.name, $d: toBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
    } else if (Array.isArray(v)) {
      if (v.every((x) => typeof x === 'number')) out[key] = v.slice();
      else if (v.every((x) => x && typeof x === 'object')) out[key] = { $a: v.map((x) => snapshot(x)) };
    } else if (t === 'object') {
      out[key] = snapshot(v);
    }
  }
  return out;
}

export function restore(obj, data) {
  for (const key of Object.keys(data)) {
    if (!(key in obj)) continue;
    const v = data[key];
    const cur = obj[key];
    if (v && typeof v === 'object' && '$t' in v) {
      const bytes = fromBase64(v.$d);
      if (ArrayBuffer.isView(cur) && cur.byteLength === bytes.byteLength) {
        new Uint8Array(cur.buffer, cur.byteOffset, cur.byteLength).set(bytes);
      } else {
        const Ctor = globalThis[v.$t] || Uint8Array;
        obj[key] = new Ctor(bytes.buffer, 0, bytes.byteLength / (Ctor.BYTES_PER_ELEMENT || 1));
      }
    } else if (v && typeof v === 'object' && '$a' in v) {
      v.$a.forEach((d, i) => cur[i] && restore(cur[i], d));
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      if (cur && typeof cur === 'object') restore(cur, v);
    } else {
      obj[key] = Array.isArray(v) ? v.slice() : v;
    }
  }
}
