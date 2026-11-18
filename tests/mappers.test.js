import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { NES } from '../src/nes.js';
import { parseINES, RomError } from '../src/cartridge.js';
import { MIRROR_HORIZONTAL, MIRROR_VERTICAL, MIRROR_SINGLE_A, MIRROR_FOUR } from '../src/ppu.js';
import { IRQ_MAPPER } from '../src/cpu.js';
import { buildRom } from './helpers/rom.js';

// Fill each 8 KB PRG bank with its own index so bank switching is visible.
const tagBanks = (prg) => { for (let i = 0; i < prg.length; i++) prg[i] = i >> 13; };
const loop = [0x4c, 0x00, 0x80]; // JMP $8000

function boot(opts) {
  const nes = new NES();
  nes.loadRom(buildRom({ program: loop, fill: tagBanks, ...opts }));
  return nes;
}
const bankAt = (nes, addr) => nes.mapper.cpuRead(addr | 0x100);

describe('iNES parsing', () => {
  test('rejects non-iNES data', () => {
    assert.throws(() => parseINES(new Uint8Array(32)), RomError);
  });
  test('reads mapper number, mirroring, battery and CHR RAM', () => {
    const rom = buildRom({ mapper: 4, chrBanks: 0, flags6: 0x03 });
    const cart = parseINES(rom);
    assert.equal(cart.mapper, 4);
    assert.equal(cart.mirroring, MIRROR_VERTICAL);
    assert.equal(cart.battery, true);
    assert.equal(cart.chrRam, true);
    assert.equal(parseINES(buildRom({ flags6: 0x08 })).mirroring, MIRROR_FOUR);
  });
  test('computes a stable CRC32', () => {
    assert.equal(parseINES(buildRom()).crc, parseINES(buildRom()).crc);
    assert.notEqual(parseINES(buildRom()).crc, parseINES(buildRom({ program: [0xea] })).crc);
  });
});

describe('NROM (0)', () => {
  test('16 KB PRG is mirrored at $C000', () => {
    const nes = new NES();
    nes.loadRom(buildRom({ prgBanks: 1, program: loop, org: 0xc000, fill: (p) => p.fill(0x11) }));
    assert.equal(nes.mapper.cpuRead(0x8100), 0x11);
    assert.equal(nes.mapper.cpuRead(0x8000), nes.mapper.cpuRead(0xc000));
  });
});

describe('UxROM (2)', () => {
  test('switches $8000 and fixes the last bank', () => {
    const nes = boot({ mapper: 2, prgBanks: 8, org: 0xc000, chrBanks: 0 });
    nes.mapper.cpuWrite(0x8000, 3);
    assert.equal(bankAt(nes, 0x8000), 6);
    assert.equal(bankAt(nes, 0xc000), 14);
  });
});

describe('CNROM (3)', () => {
  test('switches 8 KB CHR (with bus conflicts)', () => {
    const nes = new NES();
    const rom = buildRom({ mapper: 3, chrBanks: 4, program: loop, fill: (p) => p.fill(0xff) });
    for (let b = 0; b < 4; b++) rom[16 + 0x8000 + b * 0x2000] = 0xa0 + b;
    nes.loadRom(rom);
    nes.mapper.cpuWrite(0x8100, 2);
    assert.equal(nes.mapper.chrRead(0), 0xa2);
  });
});

describe('MMC1 (1)', () => {
  const serial = (nes, addr, value) => {
    for (let i = 0; i < 5; i++) {
      nes.cpu.cycles += 2; // writes on consecutive cycles are ignored
      nes.mapper.cpuWrite(addr, (value >> i) & 1);
    }
  };
  test('serial writes select PRG banks and mirroring', () => {
    const nes = boot({ mapper: 1, prgBanks: 8 });
    serial(nes, 0x8000, 0x0e); // vertical, PRG mode 3
    assert.equal(nes.ppu.mirroring, MIRROR_VERTICAL);
    serial(nes, 0xe000, 2);
    assert.equal(bankAt(nes, 0x8000), 4);
    assert.equal(bankAt(nes, 0xc000), 14);
    serial(nes, 0x8000, 0x03); // horizontal, 32 KB mode
    assert.equal(nes.ppu.mirroring, MIRROR_HORIZONTAL);
    serial(nes, 0x8000, 0x00);
    assert.equal(nes.ppu.mirroring, MIRROR_SINGLE_A);
  });
  test('bit 7 resets the shift register', () => {
    const nes = boot({ mapper: 1, prgBanks: 8 });
    nes.mapper.cpuWrite(0x8000, 1);
    nes.cpu.cycles += 2;
    nes.mapper.cpuWrite(0x8000, 0x80);
    assert.equal(nes.mapper.shift, 0x10);
  });
  test('ignores the second of two consecutive-cycle writes', () => {
    const nes = boot({ mapper: 1, prgBanks: 8 });
    nes.mapper.cpuWrite(0x8000, 1);
    nes.cpu.cycles += 1;
    nes.mapper.cpuWrite(0x8000, 1);
    assert.equal(nes.mapper.shift, 0x18);
  });
});

describe('MMC3 (4)', () => {
  test('PRG and CHR banking with mode bits', () => {
    const nes = boot({ mapper: 4, prgBanks: 8, chrBanks: 8 });
    const m = nes.mapper;
    m.cpuWrite(0x8000, 6); m.cpuWrite(0x8001, 5);
    m.cpuWrite(0x8000, 7); m.cpuWrite(0x8001, 9);
    assert.equal(bankAt(nes, 0x8000), 5);
    assert.equal(bankAt(nes, 0xa000), 9);
    assert.equal(bankAt(nes, 0xc000), 14);
    assert.equal(bankAt(nes, 0xe000), 15);
    m.cpuWrite(0x8000, 0x46); // PRG mode 1
    assert.equal(bankAt(nes, 0x8000), 14);
    assert.equal(bankAt(nes, 0xc000), 5);
    m.cpuWrite(0x8000, 0x82); m.cpuWrite(0x8001, 12); // CHR inversion, R2 -> $0000
    assert.equal(m.chrMap[0], 12 << 10);
  });
  test('mirroring register', () => {
    const nes = boot({ mapper: 4, prgBanks: 8, chrBanks: 8 });
    nes.mapper.cpuWrite(0xa000, 1);
    assert.equal(nes.ppu.mirroring, MIRROR_HORIZONTAL);
    nes.mapper.cpuWrite(0xa000, 0);
    assert.equal(nes.ppu.mirroring, MIRROR_VERTICAL);
  });
  test('scanline counter raises IRQ on A12 rising edges', () => {
    const nes = boot({ mapper: 4, prgBanks: 8, chrBanks: 8 });
    const m = nes.mapper;
    m.cpuWrite(0xc000, 2); // latch
    m.cpuWrite(0xc001, 0); // reload
    m.cpuWrite(0xe001, 0); // enable
    const edge = () => { m.ppuA12(0x0000); nes.cpu.cycles += 10; m.ppuA12(0x1000); };
    edge(); // reload -> 2
    edge(); // 1
    assert.equal(nes.cpu.irqLine & IRQ_MAPPER, 0);
    edge(); // 0 -> IRQ
    assert.ok(nes.cpu.irqLine & IRQ_MAPPER);
    m.cpuWrite(0xe000, 0); // acknowledge + disable
    assert.equal(nes.cpu.irqLine & IRQ_MAPPER, 0);
  });
  test('rapid A12 toggles are filtered', () => {
    const nes = boot({ mapper: 4, prgBanks: 8, chrBanks: 8 });
    const m = nes.mapper;
    m.cpuWrite(0xc000, 5); m.cpuWrite(0xc001, 0);
    m.ppuA12(0x1000); // first edge -> counter = 5
    for (let i = 0; i < 8; i++) { m.ppuA12(0x0000); m.ppuA12(0x1000); }
    assert.equal(m.irqCounter, 5);
  });
});

describe('AxROM (7)', () => {
  test('32 KB banks and one-screen mirroring', () => {
    const nes = boot({ mapper: 7, prgBanks: 8, chrBanks: 0 });
    nes.mapper.cpuWrite(0x8000, 0x12);
    assert.equal(bankAt(nes, 0x8000), 8);
    assert.equal(nes.ppu.ntMap[0], 0x400);
  });
});

test('unsupported mapper gives a clear error', () => {
  assert.throws(() => new NES().loadRom(buildRom({ mapper: 99 })), /Mapper 99/);
});
