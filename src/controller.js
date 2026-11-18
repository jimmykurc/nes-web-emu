// Standard NES controller: an 8-bit parallel-in / serial-out shift register.
// Bit order: A, B, Select, Start, Up, Down, Left, Right.

export const BUTTON = {
  A: 0x01, B: 0x02, SELECT: 0x04, START: 0x08,
  UP: 0x10, DOWN: 0x20, LEFT: 0x40, RIGHT: 0x80,
};

export class Controller {
  constructor() {
    this.buttons = 0;
    this.shift = 0;
    this.strobe = false;
  }

  setButtons(mask) {
    // Disallow opposite directions at once (impossible on a real D-pad and
    // known to glitch some games).
    if ((mask & 0x30) === 0x30) mask &= ~0x30;
    if ((mask & 0xc0) === 0xc0) mask &= ~0xc0;
    this.buttons = mask;
  }

  write(v) {
    this.strobe = (v & 1) !== 0;
    if (this.strobe) this.shift = this.buttons;
  }

  read() {
    if (this.strobe) return this.buttons & 1;
    const bit = this.shift & 1;
    this.shift = (this.shift >> 1) | 0x80; // official pads return 1 after 8 reads
    return bit;
  }
}
