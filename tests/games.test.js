// The bundled original games: assembler, ROM build and a scripted play-through.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assemble } from '../tools/asm6502.js';
import { buildViper } from '../tools/build-games.js';
import { NES } from '../src/nes.js';
import { BUTTON } from '../src/controller.js';
import { LIBRARY } from '../src/ui/library.js';

const hex = (r) => [...r.bytes.values()].map((b) => b.toString(16).padStart(2, '0')).join(' ');

describe('6502 assembler', () => {
  test('encodes addressing modes, zero page selection and branches', () => {
    const r = assemble(`
ZP = $10
  .org $C000
start: lda #$80
  sta $2000
  lda ZP
  sta ZP,x
  lda (ZP),y
  ldx tbl,y
  asl a
@l: dex
  bne @l
  jmp (vec)
  jsr fwd
fwd: rts
tbl: .byte 1, "AB", <start, >start
vec: .word start`);
    assert.equal(hex(r), 'a9 80 8d 00 20 a5 10 95 10 b1 10 be 19 c0 0a ca d0 fd 6c 1e c0 20 18 c0 60 01 41 42 00 c0 00 c0');
  });

  test('reports undefined symbols and out-of-range branches', () => {
    assert.throws(() => assemble('  .org $C000\n  jmp nowhere'), /undefined symbol nowhere/);
    assert.throws(() => assemble(`  .org $C000\nfar: .byte ${Array(200).fill(0).join(',')}\n  bne far`), /branch out of range/);
  });
});

describe('Pixel Viper', () => {
  const { rom, symbols } = buildViper();
  const ram = (nes, name) => nes.ram[symbols[name]];
  const boot = () => { const nes = new NES(); nes.loadRom(rom); return nes; };
  const frames = (nes, n, buttons = 0) => { for (let i = 0; i < n; i++) { nes.setButtons(0, buttons); nes.frame(); } };

  test('the committed ROM matches the source', () => {
    assert.deepEqual(new Uint8Array(readFileSync(new URL('../roms/pixel-viper.nes', import.meta.url))), rom);
  });

  test('a scripted game: start, eat apples, crash, back to the title', () => {
    const nes = boot();
    frames(nes, 30);
    assert.equal(ram(nes, 'state'), 0);
    frames(nes, 2, BUTTON.START);
    frames(nes, 3);
    assert.equal(ram(nes, 'state'), 1);

    // steer straight to each apple, then look at the score
    // directions 0 up, 1 right, 2 down, 3 left, as in the game
    const PADS = [BUTTON.UP, BUTTON.RIGHT, BUTTON.DOWN, BUTTON.LEFT];
    const DELTA = [-16, 1, 16, -1];
    const food = () => nes.ram.subarray(0x500, 0x600).indexOf(4);
    for (let t = 0; t < 4000 && ram(nes, 'state') === 1; t++) {
      const head = nes.ram[0x300 + ram(nes, 'hidx')], f = food(), dir = ram(nes, 'dir');
      const [hr, hc, fr, fc] = [head >> 4, head & 15, f >> 4, f & 15];
      const prefs = [hc < fc ? 1 : hc > fc ? 3 : -1, hr < fr ? 2 : hr > fr ? 0 : -1, dir, 0, 1, 2, 3];
      const ok = (d) => d >= 0 && d !== ((dir + 2) & 3) && [0, 4].includes(nes.ram[0x500 + ((head + DELTA[d]) & 0xff)]);
      frames(nes, 1, PADS[prefs.find(ok) ?? dir]);
      if (ram(nes, 'score') * 100 + nes.ram[symbols.score + 1] * 10 + nes.ram[symbols.score + 2] >= 3) break;
    }
    const score = nes.ram[symbols.score + 1] * 10 + nes.ram[symbols.score + 2];
    assert.ok(score >= 3, `score ${score}`);

    // drive into the wall
    for (let t = 0; t < 600 && ram(nes, 'state') === 1; t++) frames(nes, 1, BUTTON.UP);
    assert.equal(ram(nes, 'state'), 2);
    assert.equal(nes.ram[symbols.best + 2], nes.ram[symbols.score + 2]);
    frames(nes, 2, BUTTON.START);
    frames(nes, 3);
    assert.equal(ram(nes, 'state'), 1);
  });

  test('is listed in the game library', () => {
    assert.ok(LIBRARY.some((g) => g.file === 'roms/pixel-viper.nes'));
  });
});
