import { Mapper } from './mapper.js';
import { MIRROR_HORIZONTAL, MIRROR_VERTICAL, MIRROR_FOUR } from '../ppu.js';
import { IRQ_MAPPER } from '../cpu.js';

// Mapper 4: Nintendo MMC3 (TxROM). 8 KB PRG / 1-2 KB CHR banking and a
// scanline counter clocked by rising edges of PPU address line A12.
export class MMC3 extends Mapper {
  constructor(cart, nes) {
    super(cart, nes);
    this.regs = new Uint8Array(8);
    this.bankSelect = 0;
    this.irqLatch = 0;
    this.irqCounter = 0;
    this.irqReload = false;
    this.irqEnabled = false;
    this.a12 = 0;
    this.a12LowSince = 0;
    this.fourScreen = cart.mirroring === MIRROR_FOUR;
    this.regs.set([0, 2, 4, 5, 6, 7, 0, 1]);
    this.update();
  }
  get name() { return 'MMC3'; }

  writeRegister(addr, v) {
    const even = (addr & 1) === 0;
    switch (addr & 0xe000) {
      case 0x8000:
        if (even) this.bankSelect = v;
        else this.regs[this.bankSelect & 7] = v;
        this.update();
        break;
      case 0xa000:
        if (even) {
          if (!this.fourScreen) this.setMirroring(v & 1 ? MIRROR_HORIZONTAL : MIRROR_VERTICAL);
        } else {
          this.prgRamEnabled = (v & 0x80) !== 0;
          this.prgRamWritable = (v & 0x40) === 0;
        }
        break;
      case 0xc000:
        if (even) this.irqLatch = v;
        else { this.irqCounter = 0; this.irqReload = true; }
        break;
      case 0xe000:
        if (even) {
          this.irqEnabled = false;
          this.nes.cpu.setIrq(IRQ_MAPPER, false);
        } else {
          this.irqEnabled = true;
        }
        break;
    }
  }

  update() {
    const r = this.regs;
    if (this.bankSelect & 0x40) {
      this.setPrg8k(0, -2);
      this.setPrg8k(2, r[6]);
    } else {
      this.setPrg8k(0, r[6]);
      this.setPrg8k(2, -2);
    }
    this.setPrg8k(1, r[7]);
    this.setPrg8k(3, -1);
    const inv = (this.bankSelect & 0x80) ? 4 : 0;
    this.setChr1k(0 ^ inv, r[0] & 0xfe);
    this.setChr1k(1 ^ inv, r[0] | 1);
    this.setChr1k(2 ^ inv, r[1] & 0xfe);
    this.setChr1k(3 ^ inv, r[1] | 1);
    this.setChr1k(4 ^ inv, r[2]);
    this.setChr1k(5 ^ inv, r[3]);
    this.setChr1k(6 ^ inv, r[4]);
    this.setChr1k(7 ^ inv, r[5]);
  }

  // Called by the PPU for every pattern-table address it puts on the bus.
  // A rising edge on A12 after it has been low for a few CPU cycles clocks
  // the scanline counter (this filters the rapid toggling during sprite
  // fetches).
  ppuA12(addr) {
    const high = addr & 0x1000;
    if (high) {
      if (!this.a12) {
        if (this.nes.cpu.cycles - this.a12LowSince >= 3) this.clockCounter();
        this.a12 = 1;
      }
    } else if (this.a12) {
      this.a12 = 0;
      this.a12LowSince = this.nes.cpu.cycles;
    }
  }

  clockCounter() {
    if (this.irqCounter === 0 || this.irqReload) {
      this.irqCounter = this.irqLatch;
      this.irqReload = false;
    } else {
      this.irqCounter--;
    }
    if (this.irqCounter === 0 && this.irqEnabled) this.nes.cpu.setIrq(IRQ_MAPPER, true);
  }
}
