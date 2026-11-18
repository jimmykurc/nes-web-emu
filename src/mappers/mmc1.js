import { Mapper } from './mapper.js';
import { MIRROR_HORIZONTAL, MIRROR_VERTICAL, MIRROR_SINGLE_A, MIRROR_SINGLE_B } from '../ppu.js';

const MIRRORS = [MIRROR_SINGLE_A, MIRROR_SINGLE_B, MIRROR_VERTICAL, MIRROR_HORIZONTAL];

// Mapper 1: Nintendo MMC1 (SxROM). Serial 5-bit shift register interface.
// Supports SNROM/SOROM/SUROM-style outer PRG bank via CHR register bit 4
// on 512 KB boards.
export class MMC1 extends Mapper {
  constructor(cart, nes) {
    super(cart, nes);
    this.shift = 0x10;
    this.control = 0x0c;
    this.chr0 = 0;
    this.chr1 = 0;
    this.prg = 0;
    this.lastWriteCycle = -10;
    this.update();
  }
  get name() { return 'MMC1'; }

  reset() {
    this.shift = 0x10;
    this.control |= 0x0c;
    this.update();
  }

  writeRegister(addr, v) {
    // The MMC1 ignores writes on consecutive CPU cycles (e.g. the dummy
    // write of a read-modify-write instruction).
    const cycle = this.nes.cpu.cycles;
    const consecutive = cycle - this.lastWriteCycle <= 1;
    this.lastWriteCycle = cycle;
    if (v & 0x80) {
      this.shift = 0x10;
      this.control |= 0x0c;
      this.update();
      return;
    }
    if (consecutive) return;
    const done = this.shift & 1;
    this.shift = (this.shift >> 1) | ((v & 1) << 4);
    if (!done) return;
    const value = this.shift;
    this.shift = 0x10;
    switch ((addr >> 13) & 3) {
      case 0: this.control = value; break;
      case 1: this.chr0 = value; break;
      case 2: this.chr1 = value; break;
      case 3: this.prg = value; break;
    }
    this.update();
  }

  update() {
    this.setMirroring(MIRRORS[this.control & 3]);
    const prgMode = (this.control >> 2) & 3;
    // 512 KB boards (SUROM) use CHR register bit 4 as PRG A18.
    const outer = this.prgRom.length > 0x40000 ? (this.chr0 & 0x10) : 0;
    const bank = (this.prg & 0x0f) | outer;
    if (prgMode < 2) {
      this.setPrg16k(0, (bank & ~1));
      this.setPrg16k(1, (bank & ~1) | 1);
    } else if (prgMode === 2) {
      this.setPrg16k(0, outer);
      this.setPrg16k(1, bank);
    } else {
      this.setPrg16k(0, bank);
      this.setPrg16k(1, outer | 0x0f);
    }
    if (this.control & 0x10) {
      this.setChr4k(0, this.chr0);
      this.setChr4k(1, this.chr1);
    } else {
      this.setChr8k(this.chr0 >> 1);
    }
    this.prgRamEnabled = (this.prg & 0x10) === 0;
  }
}
