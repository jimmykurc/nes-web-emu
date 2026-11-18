import { Mapper } from './mapper.js';

// Mapper 0: NROM. 16 or 32 KB PRG (16 KB is mirrored), 8 KB CHR.
export class NROM extends Mapper {
  get name() { return 'NROM'; }
}
