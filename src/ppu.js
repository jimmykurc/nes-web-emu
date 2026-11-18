// Ricoh 2C02 PPU, emulated dot by dot (341 dots x 262 scanlines, NTSC).
//
// Background rendering follows the real fetch pipeline: name table, attribute
// and pattern fetches every 8 dots into 16-bit shift registers, with the
// "loopy" v/t/x/w scroll registers. Mid-frame writes to $2000/$2005/$2006
// therefore behave like on hardware (split screens, status bars, raster
// effects). Sprites are evaluated at dot 257 for the next line (including the
// buggy overflow scan) and their patterns are fetched during dots 257-320, so
// mappers that watch PPU A12 (MMC3) see a realistic address stream.

import { buildPixelTable } from './palette.js';

export const MIRROR_HORIZONTAL = 0;
export const MIRROR_VERTICAL = 1;
export const MIRROR_SINGLE_A = 2;
export const MIRROR_SINGLE_B = 3;
export const MIRROR_FOUR = 4;

const NT_LAYOUTS = [
  [0, 0, 0x400, 0x400],
  [0, 0x400, 0, 0x400],
  [0, 0, 0, 0],
  [0x400, 0x400, 0x400, 0x400],
  [0, 0x400, 0x800, 0xc00],
];

const PIXELS = buildPixelTable();

export class PPU {
  constructor(nes) {
    this.nes = nes;
    this.mapper = null;
    this.hasA12Hook = false;
    this.vram = new Uint8Array(0x1000);
    this.palette = new Uint8Array(32);
    this.oam = new Uint8Array(256);
    this.secOam = new Uint8Array(32);
    this.spriteLine = new Uint8Array(256);
    this.ntMap = new Uint16Array(4);
    this.frameBuffer = new Uint32Array(256 * 240);
    this.mirroring = MIRROR_HORIZONTAL;
    this.reset(true);
  }

  reset(power = false) {
    this.ctrl = 0;
    this.mask = 0;
    this.w = 0;
    this.readBuffer = 0;
    this.oddFrame = false;
    if (power) {
      this.status = 0;
      this.oamAddr = 0;
      this.v = 0;
      this.t = 0;
      this.fineX = 0;
      this.scanline = 0;
      this.dot = 0;
      this.frame = 0;
      this.ioLatch = 0;
      this.palette.fill(0x0f);
    }
    this.bgLo = this.bgHi = this.atLo = this.atHi = 0;
    this.ntByte = this.atByte = this.patLo = this.patHi = 0;
    this.sprCount = 0;
    this.spr0Next = false;
    this.suppressVbl = false;
    this.nmiCheck = false;
    this.frameComplete = false;
  }

  attachMapper(mapper) {
    this.mapper = mapper;
    this.hasA12Hook = typeof mapper.ppuA12 === 'function';
  }

  setMirroring(mode) {
    this.mirroring = mode;
    this.ntMap.set(NT_LAYOUTS[mode]);
  }

  // ---------------------------------------------------------------- memory

  chr(addr) {
    if (this.hasA12Hook) this.mapper.ppuA12(addr);
    return this.mapper.chrRead(addr);
  }

  readMem(addr) {
    addr &= 0x3fff;
    if (addr < 0x2000) return this.chr(addr);
    if (addr < 0x3f00) return this.vram[this.ntMap[(addr >> 10) & 3] | (addr & 0x3ff)];
    return this.palette[paletteIndex(addr)];
  }

  writeMem(addr, v) {
    addr &= 0x3fff;
    if (addr < 0x2000) {
      if (this.hasA12Hook) this.mapper.ppuA12(addr);
      this.mapper.chrWrite(addr, v);
    } else if (addr < 0x3f00) {
      this.vram[this.ntMap[(addr >> 10) & 3] | (addr & 0x3ff)] = v;
    } else {
      this.palette[paletteIndex(addr)] = v & 0x3f;
    }
  }

  // ------------------------------------------------------------- registers

  readRegister(reg) {
    switch (reg) {
      case 2: {
        let v = (this.status & 0xe0) | (this.ioLatch & 0x1f);
        // Race with VBlank start: reading one dot before suppresses the flag
        // and the NMI; reading on the same/next dot suppresses only the NMI.
        if (this.scanline === 241) {
          if (this.dot === 1) { this.suppressVbl = true; v &= 0x7f; }
          else if (this.dot === 2 || this.dot === 3) this.nes.cpu.nmiPending = false;
        }
        this.status &= 0x7f;
        this.w = 0;
        this.ioLatch = v;
        return v;
      }
      case 4: {
        let v = this.oam[this.oamAddr];
        if ((this.oamAddr & 3) === 2) v &= 0xe3;
        this.ioLatch = v;
        return v;
      }
      case 7: {
        const addr = this.v & 0x3fff;
        let v;
        if (addr >= 0x3f00) {
          v = (this.palette[paletteIndex(addr)] & ((this.mask & 1) ? 0x30 : 0x3f)) | (this.ioLatch & 0xc0);
          this.readBuffer = this.readMem(addr - 0x1000);
        } else {
          v = this.readBuffer;
          this.readBuffer = this.readMem(addr);
        }
        this.incrementV();
        this.ioLatch = v;
        return v;
      }
      default:
        return this.ioLatch;
    }
  }

  writeRegister(reg, v) {
    this.ioLatch = v;
    switch (reg) {
      case 0: {
        const wasNmi = this.ctrl & 0x80;
        this.ctrl = v;
        this.t = (this.t & 0xf3ff) | ((v & 3) << 10);
        // Enabling NMI during VBlank raises NMI, unless the flag clears first.
        if (!wasNmi && (v & 0x80) && (this.status & 0x80)) this.nmiCheck = true;
        if (!(v & 0x80) && this.scanline === 241 && this.dot <= 3) this.nes.cpu.nmiPending = false;
        break;
      }
      case 1:
        this.mask = v;
        break;
      case 3:
        this.oamAddr = v;
        break;
      case 4:
        if (this.isRendering() && (this.scanline < 240 || this.scanline === 261)) {
          this.oamAddr = (this.oamAddr + 4) & 0xff; // glitchy increment
        } else {
          this.oam[this.oamAddr] = v;
          this.oamAddr = (this.oamAddr + 1) & 0xff;
        }
        break;
      case 5:
        if (this.w === 0) {
          this.t = (this.t & 0xffe0) | (v >> 3);
          this.fineX = v & 7;
          this.w = 1;
        } else {
          this.t = (this.t & 0x8c1f) | ((v & 7) << 12) | ((v & 0xf8) << 2);
          this.w = 0;
        }
        break;
      case 6:
        if (this.w === 0) {
          this.t = (this.t & 0x00ff) | ((v & 0x3f) << 8);
          this.w = 1;
        } else {
          this.t = (this.t & 0xff00) | v;
          this.v = this.t;
          this.w = 0;
          if (this.hasA12Hook) this.mapper.ppuA12(this.v & 0x3fff);
        }
        break;
      case 7:
        this.writeMem(this.v, v);
        this.incrementV();
        break;
    }
  }

  isRendering() {
    return (this.mask & 0x18) !== 0;
  }

  incrementV() {
    if (this.isRendering() && (this.scanline < 240 || this.scanline === 261)) {
      // $2007 access during rendering bumps both coarse X and Y.
      this.incX();
      this.incY();
    } else {
      this.v = (this.v + ((this.ctrl & 0x04) ? 32 : 1)) & 0x7fff;
      if (this.hasA12Hook) this.mapper.ppuA12(this.v & 0x3fff);
    }
  }

  incX() {
    if ((this.v & 0x1f) === 31) { this.v &= ~0x1f; this.v ^= 0x400; }
    else this.v++;
  }

  incY() {
    let v = this.v;
    if ((v & 0x7000) !== 0x7000) {
      v += 0x1000;
    } else {
      v &= ~0x7000;
      let y = (v & 0x3e0) >> 5;
      if (y === 29) { y = 0; v ^= 0x800; }
      else if (y === 31) y = 0;
      else y++;
      v = (v & ~0x3e0) | (y << 5);
    }
    this.v = v;
  }

  // ------------------------------------------------------------- rendering

  step() {
    const sl = this.scanline;
    const dot = this.dot;

    if (sl < 240 || sl === 261) {
      if (sl === 261 && dot === 1) {
        this.status &= 0x1f; // clear VBlank, sprite 0 hit, overflow
      }
      if ((this.mask & 0x18) !== 0) {
        // Background pipeline
        if ((dot >= 2 && dot <= 257) || (dot >= 322 && dot <= 337)) {
          this.bgLo <<= 1; this.bgHi <<= 1; this.atLo <<= 1; this.atHi <<= 1;
        }
        if ((dot & 7) === 1 && ((dot >= 9 && dot <= 257) || dot === 329 || dot === 337)) {
          this.bgLo = (this.bgLo & 0xff00) | this.patLo;
          this.bgHi = (this.bgHi & 0xff00) | this.patHi;
          this.atLo = (this.atLo & 0xff00) | ((this.atByte & 1) ? 0xff : 0);
          this.atHi = (this.atHi & 0xff00) | ((this.atByte & 2) ? 0xff : 0);
        }
        if ((dot >= 1 && dot <= 256) || (dot >= 321 && dot <= 336)) {
          switch (dot & 7) {
            case 1:
              this.ntByte = this.vram[this.ntMap[(this.v >> 10) & 3] | (this.v & 0x3ff)];
              break;
            case 3: {
              const v = this.v;
              const a = 0x3c0 | ((v >> 4) & 0x38) | ((v >> 2) & 7);
              const b = this.vram[this.ntMap[(v >> 10) & 3] | a];
              this.atByte = (b >> (((v >> 4) & 4) | (v & 2))) & 3;
              break;
            }
            case 5:
              this.patLo = this.chr(((this.ctrl & 0x10) << 8) | (this.ntByte << 4) | ((this.v >> 12) & 7));
              break;
            case 7:
              this.patHi = this.chr(((this.ctrl & 0x10) << 8) | (this.ntByte << 4) | ((this.v >> 12) & 7) | 8);
              break;
            case 0:
              this.incX();
              break;
          }
        }
        if (dot === 256) this.incY();
        if (dot === 257) {
          this.v = (this.v & ~0x41f) | (this.t & 0x41f);
          this.spriteLine.fill(0);
          if (sl < 240) this.evaluateSprites(sl);
          else this.sprCount = 0;
        }
        if (dot >= 257 && dot <= 320 && ((dot - 257) & 7) === 4) {
          this.fetchSprite((dot - 257) >> 3, sl);
        }
        if (sl === 261 && dot >= 280 && dot <= 304) {
          this.v = (this.v & ~0x7be0) | (this.t & 0x7be0);
        }
        if (sl === 261 && dot === 338 && this.oddFrame) {
          this.dot = 339; // odd frames are one dot shorter (dot 339 skipped)
        }
      } else if (dot === 257) {
        this.spriteLine.fill(0);
        this.sprCount = 0;
      }

      if (sl < 240 && dot >= 1 && dot <= 256) this.renderPixel(dot - 1, sl);
    } else if (sl === 241 && dot === 1) {
      if (!this.suppressVbl) {
        this.status |= 0x80;
        if (this.ctrl & 0x80) this.nes.cpu.triggerNmi();
      }
      this.suppressVbl = false;
      this.frameComplete = true;
    }

    if (this.nmiCheck) {
      this.nmiCheck = false;
      if ((this.status & 0x80) && (this.ctrl & 0x80)) this.nes.cpu.triggerNmi();
    }

    if (++this.dot > 340) {
      this.dot = 0;
      if (++this.scanline > 261) {
        this.scanline = 0;
        this.frame++;
        this.oddFrame = !this.oddFrame;
      }
    }
  }

  renderPixel(x, y) {
    const m = this.mask;
    let bg = 0;
    if ((m & 0x08) && (x >= 8 || (m & 0x02))) {
      const sh = 15 - this.fineX;
      bg = ((this.bgLo >> sh) & 1) | (((this.bgHi >> sh) & 1) << 1);
      if (bg) bg |= (((this.atLo >> sh) & 1) | (((this.atHi >> sh) & 1) << 1)) << 2;
    }
    let idx = bg;
    if ((m & 0x10) && (x >= 8 || (m & 0x04))) {
      const s = this.spriteLine[x];
      if (s) {
        if ((s & 0x20) && bg && x !== 255) this.status |= 0x40;
        if (!(bg && (s & 0x10))) idx = 0x10 | (s & 0x0f);
      }
    }
    let color;
    if ((m & 0x18) === 0 && (this.v & 0x3f00) === 0x3f00) {
      color = this.palette[this.v & 0x1f]; // "background palette hack"
    } else {
      color = this.palette[idx];
    }
    if (m & 1) color &= 0x30;
    this.frameBuffer[(y << 8) | x] = PIXELS[((m >> 5) << 6) | color];
  }

  evaluateSprites(sl) {
    const h = (this.ctrl & 0x20) ? 16 : 8;
    const oam = this.oam;
    let count = 0;
    let n = 0;
    this.spr0Next = false;
    for (; n < 64; n++) {
      const row = sl - oam[n << 2];
      if (row >= 0 && row < h) {
        const o = count << 2, src = n << 2;
        this.secOam[o] = oam[src];
        this.secOam[o + 1] = oam[src + 1];
        this.secOam[o + 2] = oam[src + 2];
        this.secOam[o + 3] = oam[src + 3];
        if (n === 0) this.spr0Next = true;
        if (++count === 8) { n++; break; }
      }
    }
    if (count === 8) {
      // Hardware overflow bug: after 8 sprites the byte offset m increments
      // together with n, so the PPU checks tile/attr/x bytes as Y coordinates.
      let m = 0;
      while (n < 64) {
        const row = sl - oam[(n << 2) + m];
        if (row >= 0 && row < h) { this.status |= 0x20; break; }
        n++;
        m = (m + 1) & 3;
      }
    }
    this.sprCount = count;
  }

  fetchSprite(i, sl) {
    const tall = (this.ctrl & 0x20) !== 0;
    const h = tall ? 16 : 8;
    let addr;
    if (i < this.sprCount) {
      const o = i << 2;
      const tile = this.secOam[o + 1];
      const attr = this.secOam[o + 2];
      let row = sl - this.secOam[o];
      if (attr & 0x80) row = h - 1 - row;
      if (tall) {
        addr = ((tile & 1) << 12) | ((tile & 0xfe) << 4);
        if (row >= 8) { addr += 16; row -= 8; }
      } else {
        addr = ((this.ctrl & 0x08) << 9) | (tile << 4);
      }
      addr |= row;
      const lo = this.chr(addr);
      const hi = this.chr(addr | 8);
      const x0 = this.secOam[o + 3];
      const flip = (attr & 0x40) !== 0;
      const meta = ((attr & 3) << 2) | ((attr & 0x20) ? 0x10 : 0) | (i === 0 && this.spr0Next ? 0x20 : 0);
      const line = this.spriteLine;
      for (let b = 0; b < 8; b++) {
        const px = x0 + b;
        if (px > 255) break;
        const bit = flip ? b : 7 - b;
        const c = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1);
        if (c && line[px] === 0) line[px] = c | meta;
      }
    } else {
      // Empty slots still fetch tile $FF (keeps A12 behaviour realistic).
      addr = tall ? 0x1ff0 : (((this.ctrl & 0x08) << 9) | 0xff0);
      this.chr(addr);
      this.chr(addr | 8);
    }
  }
}

function paletteIndex(addr) {
  let i = addr & 0x1f;
  if ((i & 0x13) === 0x10) i &= 0x0f; // $3F10/$14/$18/$1C mirror $3F00/...
  return i;
}
