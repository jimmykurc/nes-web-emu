// Attract screen shown before a ROM is loaded: a little synthwave scene drawn
// at the NES's native 256x240 resolution using only NES palette colours.
import { NES_PALETTE } from '../palette.js';
import { drawText, drawOutlinedText, textWidth } from './font.js';

const abgr = (i) => {
  const rgb = NES_PALETTE[i];
  return 0xff000000 | ((rgb & 0xff) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 0xff);
};
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const SKY = [0x0f, 0x0f, 0x01, 0x02, 0x03, 0x04, 0x14, 0x15, 0x25].map(abgr);
const SUN = [0x38, 0x28, 0x27, 0x26, 0x25, 0x24].map(abgr);
const HORIZON = 150;

export class IdleScreen {
  constructor(buf) {
    this.buf = buf;
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    this.stars = Array.from({ length: 70 }, () => ({ x: (rnd() * 256) | 0, y: (rnd() * (HORIZON - 20)) | 0, p: rnd() * 6.28, s: rnd() }));
    this.white = abgr(0x30); this.grey = abgr(0x10); this.dim = abgr(0x00);
    this.grid = abgr(0x24); this.gridFar = abgr(0x14); this.floor = abgr(0x0f);
    this.cyan = abgr(0x21); this.shadow = abgr(0x04); this.black = abgr(0x0f);
  }

  draw(t) {
    const buf = this.buf;
    const sec = t / 1000;
    // Sky: dithered vertical gradient
    for (let y = 0; y < HORIZON; y++) {
      const f = (y / HORIZON) * (SKY.length - 1);
      const i = Math.floor(f);
      const frac = ((f - i) * 16) | 0;
      for (let x = 0; x < 256; x++) {
        buf[(y << 8) | x] = SKY[frac > BAYER[((y & 3) << 2) | (x & 3)] ? Math.min(i + 1, SKY.length - 1) : i];
      }
    }
    // Stars
    for (const s of this.stars) {
      const tw = Math.sin(sec * (1 + s.s * 2) + s.p);
      if (tw > -0.3) buf[(s.y << 8) | s.x] = tw > 0.6 ? this.white : this.grey;
    }
    // Sun with scrolling stripes
    const cx = 128, cy = HORIZON - 6, r = 46;
    for (let y = cy - r; y < HORIZON; y++) {
      const dy = y - cy;
      const half = Math.sqrt(Math.max(0, r * r - dy * dy));
      const k = (y - (cy - r)) / (r * 1.15);
      if (y > cy - 18) {
        const band = (y - (cy - 18) + ((sec * 8) | 0)) % 10;
        const gap = 1 + ((y - (cy - 18)) / 9) | 0;
        if (band < gap) continue;
      }
      const c = SUN[Math.min(SUN.length - 1, (k * SUN.length) | 0)];
      for (let x = Math.ceil(cx - half); x < cx + half; x++) buf[(y << 8) | x] = c;
    }
    // Floor + perspective grid
    for (let y = HORIZON; y < 240; y++) buf.fill(this.floor, y << 8, (y + 1) << 8);
    const scroll = (sec * 0.9) % 1;
    for (let i = 0; i < 14; i++) {
      const z = i + 1 - scroll;
      const y = HORIZON + Math.round(90 / z) - 4;
      if (y <= HORIZON || y >= 240) continue;
      buf.fill(z > 5 ? this.gridFar : this.grid, y << 8, (y + 1) << 8);
    }
    buf.fill(this.grid, HORIZON << 8, (HORIZON + 1) << 8);
    for (let i = -16; i <= 16; i++) {
      for (let y = HORIZON; y < 240; y++) {
        const x = Math.round(128 + i * 9 * ((y - HORIZON) / 6 + 0.6));
        if (x >= 0 && x < 256) buf[(y << 8) | x] = y - HORIZON < 12 ? this.gridFar : this.grid;
      }
    }
    // Title
    const title = 'NES WEB EMU';
    const tx = (256 - textWidth(title, 3)) >> 1;
    const bob = Math.round(Math.sin(sec * 2) * 2);
    drawText(buf, title, tx + 2, 34 + bob + 2, this.shadow, 3);
    const grad = [0x30, 0x30, 0x31, 0x21, 0x21, 0x11, 0x11].map(abgr);
    drawText(buf, title, tx, 34 + bob, (row) => grad[row], 3);
    const sub = 'A NINTENDO ENTERTAINMENT SYSTEM EMULATOR';
    drawOutlinedText(buf, sub, (256 - textWidth(sub)) >> 1, 66, this.grey, this.black);
    // Prompt
    if (Math.floor(sec * 1.6) % 2 === 0) {
      const p = 'DROP A .NES FILE TO PLAY';
      drawOutlinedText(buf, p, (256 - textWidth(p)) >> 1, 196, this.white, this.black);
    }
    const p2 = 'OR PRESS LOAD ROM';
    drawOutlinedText(buf, p2, (256 - textWidth(p2)) >> 1, 210, this.cyan, this.black);
  }
}
