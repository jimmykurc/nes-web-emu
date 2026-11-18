// Base class for cartridge boards. PRG is exposed through four 8 KB windows
// ($8000-$FFFF) and CHR through eight 1 KB windows ($0000-$1FFF), so every
// board only has to compute bank numbers.

export class Mapper {
  constructor(cart, nes) {
    this.cart = cart;
    this.nes = nes;
    this.prgRom = cart.prg;
    this.chrIsRam = cart.chrRam;
    this.chr = cart.chrRam ? new Uint8Array(0x2000) : cart.chr;
    this.prgRam = new Uint8Array(cart.prgRamSize || 0x2000);
    if (cart.trainer) this.prgRam.set(cart.trainer, 0x1000);
    this.prgRamEnabled = true;
    this.prgRamWritable = true;
    this.sramDirty = false;
    this.prgMap = new Int32Array(4);
    this.chrMap = new Int32Array(8);
    this.setPrg32k(0);
    this.setChr8k(0);
  }

  get name() { return 'Unknown'; }

  reset() {}

  // ---- bank helpers (negative bank numbers count from the end)
  prgBankCount8k() { return this.prgRom.length >> 13; }
  setPrg8k(slot, bank) {
    const n = this.prgBankCount8k();
    bank = ((bank % n) + n) % n;
    this.prgMap[slot] = bank << 13;
  }
  setPrg16k(slot, bank) {
    this.setPrg8k(slot * 2, bank * 2);
    this.setPrg8k(slot * 2 + 1, bank * 2 + 1);
  }
  setPrg32k(bank) {
    for (let i = 0; i < 4; i++) this.setPrg8k(i, bank * 4 + i);
  }
  setChr1k(slot, bank) {
    const n = this.chr.length >> 10;
    bank = ((bank % n) + n) % n;
    this.chrMap[slot] = bank << 10;
  }
  setChr2k(slot, bank) { this.setChr1k(slot * 2, bank * 2); this.setChr1k(slot * 2 + 1, bank * 2 + 1); }
  setChr4k(slot, bank) { for (let i = 0; i < 4; i++) this.setChr1k(slot * 4 + i, bank * 4 + i); }
  setChr8k(bank) { for (let i = 0; i < 8; i++) this.setChr1k(i, bank * 8 + i); }

  setMirroring(mode) { this.nes.ppu.setMirroring(mode); }

  // ---- CPU side ($4020-$FFFF). Return -1 for open bus.
  cpuRead(addr) {
    if (addr >= 0x8000) return this.prgRom[this.prgMap[(addr >> 13) & 3] | (addr & 0x1fff)];
    if (addr >= 0x6000) return this.prgRamEnabled ? this.prgRam[addr & 0x1fff] : -1;
    return -1;
  }

  cpuWrite(addr, v) {
    if (addr >= 0x6000 && addr < 0x8000) {
      if (this.prgRamEnabled && this.prgRamWritable) {
        this.prgRam[addr & 0x1fff] = v;
        this.sramDirty = true;
      }
    } else if (addr >= 0x8000) {
      this.writeRegister(addr, v);
    }
  }

  writeRegister() {}

  // ---- PPU side ($0000-$1FFF)
  chrRead(addr) {
    return this.chr[this.chrMap[addr >> 10] | (addr & 0x3ff)];
  }

  chrWrite(addr, v) {
    if (this.chrIsRam) this.chr[this.chrMap[addr >> 10] | (addr & 0x3ff)] = v;
  }
}
