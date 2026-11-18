// Runs kevtris' nestest.nes in automation mode ($C000) and compares the CPU
// state before every instruction with the reference log (8991 lines,
// official + unofficial opcodes, cycle counts included).
//
// The ROM is not redistributed: run `npm run fetch-test-roms` first,
// otherwise this test is skipped.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NES } from '../src/nes.js';

const dir = fileURLToPath(new URL('../test-roms/', import.meta.url));
const romPath = dir + 'nestest.nes';
const logPath = dir + 'nestest.log';
const available = existsSync(romPath) && existsSync(logPath);

const hex = (n, w = 2) => n.toString(16).toUpperCase().padStart(w, '0');

test('nestest: CPU trace matches the reference log', { skip: !available && 'test-roms/nestest.nes not found' }, () => {
  const nes = new NES();
  nes.loadRom(readFileSync(romPath));
  const cpu = nes.cpu;
  cpu.pc = 0xc000;
  const lines = readFileSync(logPath, 'utf8').split(/\r?\n/).filter(Boolean);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = /^([0-9A-F]{4}).*A:([0-9A-F]{2}) X:([0-9A-F]{2}) Y:([0-9A-F]{2}) P:([0-9A-F]{2}) SP:([0-9A-F]{2}).*CYC:(\d+)/.exec(line);
    const got = `${hex(cpu.pc, 4)} A:${hex(cpu.a)} X:${hex(cpu.x)} Y:${hex(cpu.y)} P:${hex(cpu.p)} SP:${hex(cpu.s)} CYC:${cpu.cycles}`;
    const want = `${m[1]} A:${m[2]} X:${m[3]} Y:${m[4]} P:${m[5]} SP:${m[6]} CYC:${m[7]}`;
    if (got !== want) {
      assert.fail(`mismatch at line ${i + 1}\n  want: ${want}\n  got:  ${got}\n  prev: ${lines[i - 1] || ''}`);
    }
    cpu.step();
  }
  // nestest reports failures in $02/$03; both must be zero.
  assert.equal(nes.ram[2], 0, 'official opcode error code');
  assert.equal(nes.ram[3], 0, 'unofficial opcode error code');
});
