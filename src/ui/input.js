// Keyboard, Gamepad API and touch input mapped to NES controller bits.
import { BUTTON } from '../controller.js';

export const KEYMAP = {
  ArrowUp: BUTTON.UP, ArrowDown: BUTTON.DOWN, ArrowLeft: BUTTON.LEFT, ArrowRight: BUTTON.RIGHT,
  KeyW: BUTTON.UP, KeyS: BUTTON.DOWN, KeyA: BUTTON.LEFT, KeyD: BUTTON.RIGHT,
  KeyX: BUTTON.A, KeyK: BUTTON.A,
  KeyZ: BUTTON.B, KeyJ: BUTTON.B,
  Enter: BUTTON.START,
  ShiftRight: BUTTON.SELECT, ShiftLeft: BUTTON.SELECT, Tab: BUTTON.SELECT,
};

// Standard Gamepad mapping: face buttons follow the NES layout
// (right = A, bottom/left = B).
const PAD_BUTTONS = [
  [1, BUTTON.A], [3, BUTTON.A], [0, BUTTON.B], [2, BUTTON.B],
  [8, BUTTON.SELECT], [9, BUTTON.START],
  [12, BUTTON.UP], [13, BUTTON.DOWN], [14, BUTTON.LEFT], [15, BUTTON.RIGHT],
];

export class Input {
  constructor() {
    this.keys = 0;
    this.touch = 0;
    this.pads = [];
  }

  keyDown(code) {
    const b = KEYMAP[code];
    if (b === undefined) return false;
    this.keys |= b;
    return true;
  }

  keyUp(code) {
    const b = KEYMAP[code];
    if (b === undefined) return false;
    this.keys &= ~b;
    return true;
  }

  releaseAll() { this.keys = 0; this.touch = 0; }

  pollGamepads() {
    const list = navigator.getGamepads ? Array.from(navigator.getGamepads()).filter(Boolean) : [];
    this.pads = list;
    return list.slice(0, 2).map((gp) => {
      let m = 0;
      for (const [i, bit] of PAD_BUTTONS) if (gp.buttons[i] && gp.buttons[i].pressed) m |= bit;
      const [ax = 0, ay = 0] = gp.axes;
      if (ax < -0.5) m |= BUTTON.LEFT; else if (ax > 0.5) m |= BUTTON.RIGHT;
      if (ay < -0.5) m |= BUTTON.UP; else if (ay > 0.5) m |= BUTTON.DOWN;
      return m;
    });
  }

  // Returns [player1, player2] button masks.
  read() {
    const pads = this.pollGamepads();
    return [this.keys | this.touch | (pads[0] || 0), pads[1] || 0];
  }
}

// Wire up an on-screen touch pad. Elements carry data-btn="UP" etc.
export function bindTouchPad(root, input) {
  const active = new Map(); // pointerId -> mask
  const update = () => {
    let m = 0;
    for (const v of active.values()) m |= v;
    input.touch = m;
    root.querySelectorAll('[data-btn]').forEach((el) => {
      el.classList.toggle('pressed', (m & maskOf(el)) !== 0 && maskOf(el) !== 0);
    });
  };
  const maskOf = (el) => (el ? el.dataset.btn.split(' ').reduce((a, n) => a | BUTTON[n], 0) : 0);
  const at = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    return el && root.contains(el) ? el.closest('[data-btn]') : null;
  };
  root.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    root.setPointerCapture?.(e.pointerId);
    active.set(e.pointerId, maskOf(at(e)));
    update();
    navigator.vibrate?.(8);
  });
  root.addEventListener('pointermove', (e) => {
    if (!active.has(e.pointerId)) return;
    active.set(e.pointerId, maskOf(at(e)));
    update();
  });
  const end = (e) => { active.delete(e.pointerId); update(); };
  root.addEventListener('pointerup', end);
  root.addEventListener('pointercancel', end);
  root.addEventListener('contextmenu', (e) => e.preventDefault());
}
