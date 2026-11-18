// Browser front end: ROM loading, main loop, audio/video output, input,
// persistence and UI controls.
import { NES } from '../nes.js';
import { MAPPER_NAMES } from '../mappers/index.js';
import { MIRROR_FOUR, MIRROR_HORIZONTAL, MIRROR_VERTICAL } from '../ppu.js';
import { AudioOutput } from './audio.js';
import { Input, bindTouchPad } from './input.js';
import { IdleScreen } from './idle.js';
import { storage } from './storage.js';
import { LIBRARY } from './library.js';

const FRAME_MS = 1000 / 60.0988;
const $ = (sel) => document.querySelector(sel);

const canvas = $('#screen');
const ctx = canvas.getContext('2d', { alpha: false });
const image = ctx.createImageData(256, 240);
const pixels = new Uint32Array(image.data.buffer);
const idle = new IdleScreen(pixels);
const audio = new AudioOutput();
const input = new Input();

const settings = Object.assign({ scale: 'fit', crt: true, volume: 0.8, muted: false, slot: 1 }, storage.settings());

let nes = null;
let romName = '';
let paused = false;
let lastTime = performance.now();
let acc = 0;
let fpsFrames = 0;
let fpsTime = performance.now();

// ------------------------------------------------------------ ROM loading

async function loadRomBytes(bytes, name) {
  await audio.start();
  let next;
  try {
    next = new NES({ sampleRate: audio.sampleRate });
    next.ppu.frameBuffer = pixels;
    next.loadRom(bytes);
  } catch (err) {
    toast(err.message, 'error');
    return;
  }
  persistSram();
  nes = next;
  romName = name.replace(/\.nes$/i, '');
  const sram = nes.hasBattery && storage.loadSram(nes.cart.crc);
  if (sram) nes.setSram(sram);
  audio.clear();
  acc = 0;
  setPaused(false);
  document.body.classList.add('running');
  updateInfo();
  toast(`Loaded ${romName}`);
}

async function loadFile(file) {
  if (!file) return;
  const buf = new Uint8Array(await file.arrayBuffer());
  loadRomBytes(buf, file.name);
}

function updateInfo() {
  if (!nes) return;
  const c = nes.cart;
  const mirror = c.mirroring === MIRROR_FOUR ? 'four-screen' : c.mirroring === MIRROR_VERTICAL ? 'vertical' : c.mirroring === MIRROR_HORIZONTAL ? 'horizontal' : '';
  $('#rom-name').textContent = romName;
  $('#rom-meta').textContent = [
    `Mapper ${c.mapper} · ${nes.mapper.name}`,
    `PRG ${c.prg.length / 1024} KB`,
    c.chrRam ? 'CHR RAM' : `CHR ${c.chr.length / 1024} KB`,
    mirror,
    c.battery ? 'battery' : '',
  ].filter(Boolean).join(' · ');
  $('#rom-crc').textContent = `CRC32 ${c.crc}`;
}

// ------------------------------------------------------------- main loop

function present() {
  ctx.putImageData(image, 0, 0);
}

function loop(now) {
  requestAnimationFrame(loop);
  let dt = now - lastTime;
  lastTime = now;
  if (dt > 250) dt = FRAME_MS; // tab was hidden: don't try to catch up

  if (!nes) {
    idle.draw(now);
    present();
    return;
  }
  if (paused) return;

  acc += dt;
  let ran = 0;
  while (acc >= FRAME_MS && ran < 4) {
    const [p1, p2] = input.read();
    nes.setButtons(0, p1);
    nes.setButtons(1, p2);
    nes.apu.rateAdjust = audio.rateAdjust();
    nes.frame();
    acc -= FRAME_MS;
    ran++;
    fpsFrames++;
  }
  if (ran === 4) acc = 0;
  if (ran) {
    present();
    audio.push(nes.apu.takeSamples());
  }
  if (now - fpsTime >= 500) {
    $('#fps').textContent = `${Math.round((fpsFrames * 1000) / (now - fpsTime))} FPS`;
    fpsFrames = 0;
    fpsTime = now;
  }
}

// ---------------------------------------------------------- persistence

function persistSram(force = false) {
  if (!nes || !nes.hasBattery) return;
  if (!force && !nes.mapper.sramDirty) return;
  nes.mapper.sramDirty = false;
  storage.saveSram(nes.cart.crc, nes.getSram());
}
setInterval(persistSram, 3000);
addEventListener('visibilitychange', () => { if (document.hidden) persistSram(); });
addEventListener('pagehide', () => persistSram());

function saveState() {
  if (!nes) return;
  const ok = storage.saveState(nes.cart.crc, settings.slot, nes.saveState());
  toast(ok ? `State saved to slot ${settings.slot}` : 'Could not save state (storage full?)', ok ? '' : 'error');
}

function loadState() {
  if (!nes) return;
  const entry = storage.loadState(nes.cart.crc, settings.slot);
  if (!entry) { toast(`Slot ${settings.slot} is empty`, 'error'); return; }
  try {
    nes.loadState(entry.state);
    audio.clear();
    present();
    toast(`Loaded slot ${settings.slot} (${new Date(entry.time).toLocaleString()})`);
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ------------------------------------------------------------- controls

function setPaused(p) {
  paused = p;
  document.body.classList.toggle('paused', p && !!nes);
  $('#btn-pause').setAttribute('aria-pressed', String(p));
  $('#btn-pause .label').textContent = p ? 'Resume' : 'Pause';
  if (!p) { lastTime = performance.now(); acc = 0; }
  if (p) audio.clear();
}

function reset() {
  if (!nes) return;
  nes.reset();
  audio.clear();
  toast('Reset');
}

function applySettings() {
  const wrap = $('#screen-wrap');
  wrap.dataset.scale = settings.scale;
  wrap.style.setProperty('--scale', settings.scale === 'fit' ? '' : settings.scale);
  wrap.classList.toggle('crt', settings.crt);
  $('#btn-crt').setAttribute('aria-pressed', String(settings.crt));
  $('#scale').value = settings.scale;
  $('#slot').value = String(settings.slot);
  $('#volume').value = String(Math.round(settings.volume * 100));
  $('#btn-mute').setAttribute('aria-pressed', String(settings.muted));
  audio.setVolume(settings.volume);
  audio.setMuted(settings.muted);
  storage.saveSettings(settings);
}

function toggleFullscreen() {
  const el = $('#screen-wrap');
  if (document.fullscreenElement) document.exitFullscreen();
  else el.requestFullscreen?.().catch(() => {});
}

let toastTimer = 0;
function toast(msg, kind = '') {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast ' + kind; }, 2200);
}

$('#btn-load').addEventListener('click', () => { audio.start(); $('#file').click(); });
$('#file').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
$('#btn-pause').addEventListener('click', () => nes && setPaused(!paused));
$('#btn-reset').addEventListener('click', reset);
$('#btn-save').addEventListener('click', saveState);
$('#btn-restore').addEventListener('click', loadState);
$('#btn-crt').addEventListener('click', () => { settings.crt = !settings.crt; applySettings(); });
$('#btn-full').addEventListener('click', toggleFullscreen);
$('#btn-mute').addEventListener('click', () => { settings.muted = !settings.muted; applySettings(); });
$('#scale').addEventListener('change', (e) => { settings.scale = e.target.value; applySettings(); });
$('#slot').addEventListener('change', (e) => { settings.slot = Number(e.target.value); applySettings(); });
$('#volume').addEventListener('input', (e) => { settings.volume = Number(e.target.value) / 100; settings.muted = false; applySettings(); });
$('#screen-wrap').addEventListener('dblclick', toggleFullscreen);

// Keyboard
const HOTKEYS = {
  KeyP: () => nes && setPaused(!paused),
  Escape: () => nes && !document.fullscreenElement && setPaused(!paused),
  F2: saveState,
  F4: loadState,
  F3: reset,
  KeyF: toggleFullscreen,
  KeyM: () => { settings.muted = !settings.muted; applySettings(); },
  KeyC: () => { settings.crt = !settings.crt; applySettings(); },
};
addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  audio.start();
  if (HOTKEYS[e.code] && !e.repeat) { HOTKEYS[e.code](); e.preventDefault(); return; }
  if (input.keyDown(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => { if (input.keyUp(e.code)) e.preventDefault(); });
addEventListener('blur', () => input.releaseAll());

// Gamepads
function updatePads() {
  const pads = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
  $('#pad-status').textContent = pads.length
    ? pads.slice(0, 2).map((p, i) => `P${i + 1}: ${p.id.replace(/\s*\(.*\)\s*/, ' ').trim()}`).join(' · ')
    : 'No gamepad detected. Press a button on a connected pad.';
  document.body.classList.toggle('has-pad', pads.length > 0);
}
addEventListener('gamepadconnected', (e) => { updatePads(); toast(`Gamepad connected: ${e.gamepad.id.split('(')[0].trim()}`); });
addEventListener('gamepaddisconnected', updatePads);

// Drag and drop
let dragDepth = 0;
addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  const file = [...(e.dataTransfer?.files || [])].find((f) => /\.nes$/i.test(f.name)) || e.dataTransfer?.files?.[0];
  loadFile(file);
});

// Touch pad
bindTouchPad($('#touchpad'), input);

// Mapper table in the side panel
$('#mapper-list').innerHTML = Object.entries(MAPPER_NAMES)
  .map(([n, name]) => `<li><span class="num">${n}</span>${name}</li>`).join('');

// ---------------------------------------------------------- game library

async function loadFromUrl(path, name) {
  try {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await loadRomBytes(new Uint8Array(await res.arrayBuffer()), name);
  } catch (err) {
    toast(`Could not load ${name}: ${err.message}`, 'error');
  }
}

const libraryList = $('#library');
for (const game of LIBRARY) {
  const li = document.createElement('li');
  li.innerHTML = `
    <button class="game" type="button">
      <span class="game-title"></span>
      <span class="game-genre"></span>
      <span class="game-meta"></span>
    </button>
    <a class="game-src" target="_blank" rel="noopener">source</a>`;
  li.querySelector('.game-title').textContent = game.title + (game.original ? ' ★' : '');
  li.querySelector('.game-genre').textContent = game.genre;
  li.querySelector('.game-meta').textContent = `${game.author} · ${game.license}`;
  li.querySelector('.game-src').href = game.source;
  li.querySelector('.game').addEventListener('click', () => {
    audio.start();
    loadFromUrl(game.file, game.title);
    $('#screen').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  libraryList.append(li);
}

// Optional ?rom=relative/path.nes (same-origin only), handy for local testing.
const romParam = new URLSearchParams(location.search).get('rom');
if (romParam) {
  try {
    const url = new URL(romParam, location.href);
    if (url.origin !== location.origin) throw new Error('Only same-origin ROM URLs are allowed');
    fetch(url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((b) => loadRomBytes(new Uint8Array(b), url.pathname.split('/').pop()))
      .catch((err) => toast(`Could not load ROM: ${err.message}`, 'error'));
  } catch (err) {
    toast(err.message, 'error');
  }
}

applySettings();
updatePads();
requestAnimationFrame(loop);

// Expose for debugging in the console.
window.nesEmu = { get nes() { return nes; }, audio };
