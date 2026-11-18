// localStorage persistence for battery RAM, save states and settings.
const PREFIX = 'nes-web-emu:';

function safeGet(key) {
  try { return localStorage.getItem(PREFIX + key); } catch { return null; }
}
function safeSet(key, value) {
  try { localStorage.setItem(PREFIX + key, value); return true; } catch { return false; }
}

function b64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const storage = {
  loadSram(crc) {
    const v = safeGet('sram:' + crc);
    return v ? unb64(v) : null;
  },
  saveSram(crc, bytes) {
    return safeSet('sram:' + crc, b64(bytes));
  },
  saveState(crc, slot, state) {
    return safeSet(`state:${crc}:${slot}`, JSON.stringify({ time: Date.now(), state }));
  },
  loadState(crc, slot) {
    const v = safeGet(`state:${crc}:${slot}`);
    return v ? JSON.parse(v) : null;
  },
  settings() {
    try { return JSON.parse(safeGet('settings') || '{}'); } catch { return {}; }
  },
  saveSettings(s) {
    safeSet('settings', JSON.stringify(s));
  },
};
