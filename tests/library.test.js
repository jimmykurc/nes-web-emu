// Every game in the library exists, is credited, and boots to a drawn screen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { NES } from '../src/nes.js';
import { BUTTON } from '../src/controller.js';
import { LIBRARY } from '../src/ui/library.js';

const notices = readFileSync(new URL('../roms/README.md', import.meta.url), 'utf8');

for (const game of LIBRARY) {
  test(`${game.title} is credited and boots`, () => {
    for (const key of ['title', 'author', 'genre', 'file', 'license', 'source']) assert.ok(game[key], `${key} missing`);
    const url = new URL(`../${game.file}`, import.meta.url);
    assert.ok(existsSync(url), `${game.file} missing`);
    assert.ok(notices.includes('`' + game.file.split('/').pop() + '`'), 'not listed in roms/README.md');

    const nes = new NES();
    nes.loadRom(new Uint8Array(readFileSync(url)));
    for (let i = 0; i < 400; i++) { nes.setButtons(0, i >= 200 && i < 206 ? BUTTON.START : 0); nes.frame(); }
    assert.ok(new Set(nes.ppu.frameBuffer).size >= 2, 'screen is blank');
  });
}
