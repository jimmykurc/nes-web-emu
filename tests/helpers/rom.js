// Build tiny iNES images in memory so tests do not need external ROM files.
export function buildRom({ mapper = 0, prgBanks = 2, chrBanks = 1, flags6 = 0, program = [], org = 0x8000, nmi, irq, fill } = {}) {
  const prg = new Uint8Array(prgBanks * 0x4000);
  if (fill) fill(prg);
  const base = 0x10000 - prg.length;
  prg.set(program, org - base);
  const reset = org;
  const vec = prg.length - 6;
  const w16 = (o, v) => { prg[o] = v & 0xff; prg[o + 1] = v >> 8; };
  w16(vec, nmi ?? reset);
  w16(vec + 2, reset);
  w16(vec + 4, irq ?? reset);
  const header = new Uint8Array(16);
  header.set([0x4e, 0x45, 0x53, 0x1a, prgBanks, chrBanks, ((mapper & 0x0f) << 4) | flags6, mapper & 0xf0]);
  const out = new Uint8Array(16 + prg.length + chrBanks * 0x2000);
  out.set(header);
  out.set(prg, 16);
  return out;
}
