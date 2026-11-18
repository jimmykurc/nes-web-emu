import { Mapper } from './mapper.js';

// Mapper 3: CNROM. Fixed PRG, switchable 8 KB CHR bank.
export class CNROM extends Mapper {
  constructor(cart, nes) {
    super(cart, nes);
    this.bank = 0;
  }
  get name() { return 'CNROM'; }
  writeRegister(addr, v) {
    // Bus conflicts: the value written is ANDed with the ROM byte.
    this.bank = v & this.cpuRead(addr);
    this.setChr8k(this.bank);
  }
}
