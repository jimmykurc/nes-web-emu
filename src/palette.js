// 2C02 NTSC palette (64 entries, RGB). A widely used approximation of the
// composite output of a real NES.
export const NES_PALETTE = [
  0x666666, 0x002a88, 0x1412a7, 0x3b00a4, 0x5c007e, 0x6e0040, 0x6c0600, 0x561d00,
  0x333500, 0x0b4800, 0x005200, 0x004f08, 0x00404d, 0x000000, 0x000000, 0x000000,
  0xadadad, 0x155fd9, 0x4240ff, 0x7527fe, 0xa01acc, 0xb71e7b, 0xb53120, 0x994e00,
  0x6b6d00, 0x388700, 0x0c9300, 0x008f32, 0x007c8d, 0x000000, 0x000000, 0x000000,
  0xfffeff, 0x64b0ff, 0x9290ff, 0xc676ff, 0xf36aff, 0xfe6ecc, 0xfe8170, 0xea9e22,
  0xbcbe00, 0x88d800, 0x5ce430, 0x45e082, 0x48cdde, 0x4f4f4f, 0x000000, 0x000000,
  0xfffeff, 0xc0dfff, 0xd3d2ff, 0xe8c8ff, 0xfbc2ff, 0xfec4ea, 0xfeccc5, 0xf7d8a5,
  0xe4e594, 0xcfef96, 0xbdf4ab, 0xb3f3cc, 0xb5ebf2, 0xb8b8b8, 0x000000, 0x000000,
];

// Build 8 x 64 entries of little-endian ABGR pixels (for a Uint32Array view of
// ImageData), one block per combination of the three colour-emphasis bits.
export function buildPixelTable() {
  const out = new Uint32Array(512);
  for (let emph = 0; emph < 8; emph++) {
    for (let i = 0; i < 64; i++) {
      const rgb = NES_PALETTE[i];
      let r = (rgb >> 16) & 0xff, g = (rgb >> 8) & 0xff, b = rgb & 0xff;
      // Emphasis darkens the two channels that are not emphasised.
      const att = 0.79;
      if (emph & 1) { g *= att; b *= att; }
      if (emph & 2) { r *= att; b *= att; }
      if (emph & 4) { r *= att; g *= att; }
      out[(emph << 6) | i] = 0xff000000 | (Math.round(b) << 16) | (Math.round(g) << 8) | Math.round(r);
    }
  }
  return out;
}
