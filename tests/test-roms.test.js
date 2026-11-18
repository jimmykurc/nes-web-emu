// Runs public test ROMs (blargg, et al.) headlessly. They are not part of the
// repository: `npm run fetch-test-roms` downloads them into test-roms/.
// Missing ROMs are skipped.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NES } from '../src/nes.js';
import { runBlargg, runLegacy } from './helpers/blargg.js';
import { screenText } from './helpers/screen.js';

const dir = fileURLToPath(new URL('../test-roms/', import.meta.url));
const has = (f) => existsSync(dir + f);
const skip = (f) => !has(f) && `test-roms/${f} not found`;

describe('blargg $6000 protocol ROMs', () => {
  const roms = [
    ['official_only.nes', 'CPU: all official instructions', 4000],
    ['all_instrs.nes', 'CPU: official + unofficial instructions', 4000],
    ['instr_timing.nes', 'CPU: instruction and branch timing', 3000],
    ['ppu_vbl_nmi.nes', 'PPU: VBlank flag and NMI timing', 3000],
    ['apu_test.nes', 'APU: length, IRQ, frame counter, DMC', 2000],
    ['1-clocking.nes', 'MMC3: counter clocking', 500],
    ['2-details.nes', 'MMC3: counter details', 500],
    ['3-A12_clocking.nes', 'MMC3: A12 clocking', 500],
    ['4-scanline_timing.nes', 'MMC3: IRQ scanline timing', 800],
    ['5-MMC3.nes', 'MMC3: IRQ behaviour', 500],
  ];
  for (const [file, label, frames] of roms) {
    test(`${label} (${file})`, { skip: skip(file) }, () => {
      const r = runBlargg(dir + file, { maxFrames: frames });
      assert.equal(r.status, 0, r.text);
    });
  }
});

describe('sprite 0 hit tests (2005)', () => {
  const files = ['01.basics', '02.alignment', '03.corners', '04.flip', '05.left_clip', '06.right_edge',
    '07.screen_bottom', '08.double_height', '09.timing_basics', '10.timing_order', '11.edge_timing'];
  for (const f of files) {
    test(f, { skip: skip(f + '.nes') }, () => {
      assert.equal(runLegacy(`${dir}${f}.nes`, { frames: 400 }), 1);
    });
  }
  test('branch timing basics', { skip: skip('1.Branch_Basics.nes') }, () => {
    assert.equal(runLegacy(dir + '1.Branch_Basics.nes', { frames: 300 }), 1);
  });
});

describe('screen-reporting ROMs', () => {
  const run = (file, frames) => {
    const nes = new NES();
    nes.loadRom(readFileSync(dir + file));
    for (let i = 0; i < frames; i++) nes.frame();
    return screenText(nes);
  };
  test('cpu_dummy_reads', { skip: skip('cpu_dummy_reads.nes') }, () => {
    assert.match(run('cpu_dummy_reads.nes', 600), /Passed/);
  });
  test('cpu_timing_test6 (official instructions)', { skip: skip('cpu_timing_test.nes') }, () => {
    assert.match(run('cpu_timing_test.nes', 1200), /PASSED/);
  });
});
