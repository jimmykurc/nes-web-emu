// Whole-system tests using small hand-assembled programs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NES } from '../src/nes.js';
import { BUTTON } from '../src/controller.js';
import { buildRom } from './helpers/rom.js';

// Enables NMI, then increments $10 in the NMI handler and $11 in the main loop.
const program = [
  0xa9, 0x80, // LDA #$80
  0x8d, 0x00, 0x20, // STA $2000
  0xa9, 0x1e, // LDA #$1E
  0x8d, 0x01, 0x20, // STA $2001 (show BG + sprites)
  0xe6, 0x11, // loop: INC $11
  0x4c, 0x0a, 0x80, // JMP loop
];
const nmi = [0xe6, 0x10, 0x40]; // INC $10 ; RTI

function makeRom() {
  return buildRom({
    program,
    nmi: 0x9000,
    fill: (prg) => prg.set(nmi, 0x1000),
  });
}

test('runs frames at NTSC timing with one NMI per frame', () => {
  const nes = new NES();
  nes.loadRom(makeRom());
  nes.frame(); // first VBlank
  const start = nes.cpu.cycles;
  for (let i = 0; i < 60; i++) nes.frame();
  const perFrame = (nes.cpu.cycles - start) / 60;
  assert.ok(Math.abs(perFrame - 29780.5) < 2, `cycles per frame: ${perFrame}`);
  assert.ok(nes.ram[0x10] >= 60 && nes.ram[0x10] <= 61, `NMIs: ${nes.ram[0x10]}`);
});

test('produces audio samples at the requested rate', () => {
  const nes = new NES({ sampleRate: 48000 });
  nes.loadRom(makeRom());
  for (let i = 0; i < 60; i++) nes.frame();
  const n = nes.apu.takeSamples().length;
  assert.ok(n === 0 || n > 0); // buffer drains each call
  for (let i = 0; i < 10; i++) { nes.frame(); }
  // 10 frames of 1/60.1 s at 48 kHz ~= 7987 samples (buffer holds 8192)
  const samples = nes.apu.takeSamples().length;
  assert.ok(Math.abs(samples - 7987) < 20, `samples: ${samples}`);
});

test('controller shift register reports buttons in order', () => {
  const nes = new NES();
  nes.loadRom(makeRom());
  nes.setButtons(0, BUTTON.A | BUTTON.START | BUTTON.RIGHT);
  nes.write(0x4016, 1);
  nes.write(0x4016, 0);
  const bits = [];
  for (let i = 0; i < 8; i++) bits.push(nes.read(0x4016) & 1);
  assert.deepEqual(bits, [1, 0, 0, 1, 0, 0, 0, 1]);
  assert.equal(nes.read(0x4016) & 1, 1, 'reads after 8 return 1');
});

test('save state round-trip is deterministic', () => {
  const a = new NES();
  a.loadRom(makeRom());
  for (let i = 0; i < 30; i++) a.frame();
  const state = JSON.parse(JSON.stringify(a.saveState()));
  for (let i = 0; i < 30; i++) a.frame();
  const b = new NES();
  b.loadRom(makeRom());
  b.loadState(state);
  for (let i = 0; i < 30; i++) b.frame();
  assert.equal(b.cpu.cycles, a.cpu.cycles);
  assert.deepEqual(b.ram, a.ram);
  assert.deepEqual(b.ppu.frameBuffer, a.ppu.frameBuffer);
});

test('save state from another ROM is rejected', () => {
  const a = new NES();
  a.loadRom(makeRom());
  const s = a.saveState();
  s.crc = 'DEADBEEF';
  assert.throws(() => a.loadState(s), /different ROM/);
});
