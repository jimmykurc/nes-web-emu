import { Mapper } from './mapper.js';

// Mapper 2: UxROM. Switchable 16 KB at $8000, last bank fixed at $C000.
export class UxROM extends Mapper {
  constructor(cart, nes) {
    super(cart, nes);
    this.bank = 0;
    this.update();
  }
  get name() { return 'UxROM'; }
  writeRegister(addr, v) {
    this.bank = v;
    this.update();
  }
  update() {
    this.setPrg16k(0, this.bank);
    this.setPrg16k(1, -1);
  }
}
