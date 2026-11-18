import { Mapper } from './mapper.js';
import { MIRROR_SINGLE_A, MIRROR_SINGLE_B } from '../ppu.js';

// Mapper 7: AxROM. 32 KB PRG switching and one-screen mirroring select.
export class AxROM extends Mapper {
  constructor(cart, nes) {
    super(cart, nes);
    this.bank = 0;
    this.update();
  }
  get name() { return 'AxROM'; }
  writeRegister(addr, v) {
    this.bank = v;
    this.update();
  }
  update() {
    this.setPrg32k(this.bank & 0x0f);
    this.setMirroring(this.bank & 0x10 ? MIRROR_SINGLE_B : MIRROR_SINGLE_A);
  }
}
