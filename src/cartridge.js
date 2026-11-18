// iNES / NES 2.0 header parsing.

import { MIRROR_HORIZONTAL, MIRROR_VERTICAL, MIRROR_FOUR } from './ppu.js';

export class RomError extends Error {}

export function parseINES(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length < 16 || data[0] !== 0x4e || data[1] !== 0x45 || data[2] !== 0x53 || data[3] !== 0x1a) {
    throw new RomError('Not an iNES file (missing "NES<EOF>" header)');
  }
  const flags6 = data[6];
  let flags7 = data[7];
  const nes2 = (flags7 & 0x0c) === 0x08;
  // Old dumping tools wrote garbage ("DiskDude!") in bytes 7-15.
  if (!nes2 && (data[12] || data[13] || data[14] || data[15])) flags7 = 0;

  let mapper = (flags6 >> 4) | (flags7 & 0xf0);
  let prgBanks = data[4];
  let chrBanks = data[5];
  let submapper = 0;
  let prgRamSize = 0x2000;
  if (nes2) {
    mapper |= (data[8] & 0x0f) << 8;
    submapper = data[8] >> 4;
    prgBanks |= (data[9] & 0x0f) << 8;
    chrBanks |= (data[9] & 0xf0) << 4;
    const shift = Math.max(data[10] & 0x0f, data[10] >> 4);
    if (shift) prgRamSize = Math.max(0x2000, 64 << shift);
  }

  const hasTrainer = (flags6 & 0x04) !== 0;
  let offset = 16 + (hasTrainer ? 512 : 0);
  const prgSize = prgBanks * 0x4000;
  const chrSize = chrBanks * 0x2000;
  if (prgSize === 0) throw new RomError('ROM has no PRG data');
  if (data.length < offset + prgSize) throw new RomError('ROM file is truncated (PRG)');
  const prg = data.slice(offset, offset + prgSize);
  offset += prgSize;
  // Be lenient with slightly truncated CHR (some bad dumps).
  const chr = chrSize ? new Uint8Array(chrSize) : null;
  if (chr) chr.set(data.subarray(offset, Math.min(offset + chrSize, data.length)));

  let mirroring = (flags6 & 1) ? MIRROR_VERTICAL : MIRROR_HORIZONTAL;
  if (flags6 & 0x08) mirroring = MIRROR_FOUR;

  return {
    mapper,
    submapper,
    nes2,
    prg,
    chr,
    chrRam: !chr,
    mirroring,
    battery: (flags6 & 0x02) !== 0,
    trainer: hasTrainer ? data.slice(16, 16 + 512) : null,
    prgRamSize,
    crc: crc32(data.subarray(16 + (hasTrainer ? 512 : 0))),
  };
}

let CRC_TABLE = null;
export function crc32(bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0').toUpperCase();
}
