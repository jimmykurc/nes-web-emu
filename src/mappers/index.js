import { NROM } from './nrom.js';
import { MMC1 } from './mmc1.js';
import { UxROM } from './uxrom.js';
import { CNROM } from './cnrom.js';
import { MMC3 } from './mmc3.js';
import { AxROM } from './axrom.js';

export const MAPPERS = {
  0: NROM,
  1: MMC1,
  2: UxROM,
  3: CNROM,
  4: MMC3,
  7: AxROM,
};

export function createMapper(cart, nes) {
  const Board = MAPPERS[cart.mapper];
  if (!Board) throw new Error(`Mapper ${cart.mapper} is not supported yet`);
  return new Board(cart, nes);
}
