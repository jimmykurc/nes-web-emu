// Headless runner for blargg-style test ROMs that report through $6000:
//   $6000 = status ($80 running, $81 needs reset, otherwise result code)
//   $6001-$6003 = signature DE B0 61, $6004+ = zero-terminated text.
import { readFileSync } from 'node:fs';
import { NES } from '../../src/nes.js';

export function runBlargg(path, { maxFrames = 3000 } = {}) {
  const nes = new NES();
  nes.loadRom(readFileSync(path));
  let resetAt = -1;
  for (let f = 0; f < maxFrames; f++) {
    nes.frame();
    const ram = nes.mapper.prgRam;
    if (ram[1] !== 0xde || ram[2] !== 0xb0 || ram[3] !== 0x61) continue;
    const status = ram[0];
    if (status === 0x81 && resetAt < 0) resetAt = f + 6; // ~100 ms later
    if (resetAt === f) { nes.reset(); resetAt = -2; }
    if (status < 0x80) {
      let text = '';
      for (let i = 4; i < ram.length && ram[i]; i++) text += String.fromCharCode(ram[i]);
      return { status, text: text.trim(), frames: f };
    }
  }
  return { status: -1, text: 'timeout', frames: maxFrames };
}

// Older blargg ROMs (sprite_hit_tests_2005, etc.) leave the result in $F8:
// 1 = pass, anything else = failing test number.
export function runLegacy(path, { frames = 600 } = {}) {
  const nes = new NES();
  nes.loadRom(readFileSync(path));
  for (let f = 0; f < frames; f++) nes.frame();
  return nes.ram[0xf8];
}
