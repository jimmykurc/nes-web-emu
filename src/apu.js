// 2A03 APU: two pulse channels, triangle, noise and delta modulation (DMC),
// frame sequencer with IRQ, non-linear mixer and band-limiting filters.
// Clocked once per CPU cycle; output is box-filtered down to the host
// sample rate.

import { IRQ_APU_FRAME, IRQ_DMC } from './cpu.js';

export const CPU_HZ = 1789773;

const LENGTH_TABLE = [
  10, 254, 20, 2, 40, 4, 80, 6, 160, 8, 60, 10, 14, 12, 26, 14,
  12, 16, 24, 18, 48, 20, 96, 22, 192, 24, 72, 26, 16, 28, 32, 30,
];
const DUTY = [
  [0, 1, 0, 0, 0, 0, 0, 0],
  [0, 1, 1, 0, 0, 0, 0, 0],
  [0, 1, 1, 1, 1, 0, 0, 0],
  [1, 0, 0, 1, 1, 1, 1, 1],
];
const TRIANGLE = [15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const NOISE_PERIOD = [4, 8, 16, 32, 64, 96, 128, 160, 202, 254, 380, 508, 762, 1016, 2034, 4068];
const DMC_RATE = [428, 380, 340, 320, 286, 254, 226, 214, 190, 160, 142, 128, 106, 84, 72, 54];

// Non-linear mixer lookup tables (see nesdev "APU Mixer").
const PULSE_MIX = new Float32Array(31);
for (let i = 1; i < 31; i++) PULSE_MIX[i] = 95.52 / (8128 / i + 100);
const TND_MIX = new Float32Array(203);
for (let i = 1; i < 203; i++) TND_MIX[i] = 163.67 / (24329 / i + 100);

class Envelope {
  constructor() { this.start = false; this.divider = 0; this.decay = 0; this.loop = false; this.constant = false; this.volume = 0; }
  clock() {
    if (this.start) {
      this.start = false;
      this.decay = 15;
      this.divider = this.volume;
    } else if (this.divider === 0) {
      this.divider = this.volume;
      if (this.decay > 0) this.decay--;
      else if (this.loop) this.decay = 15;
    } else {
      this.divider--;
    }
  }
  output() { return this.constant ? this.volume : this.decay; }
}

class Pulse {
  constructor(channel) {
    this.channel = channel; // 1 or 2 (sweep negate differs)
    this.enabled = false;
    this.env = new Envelope();
    this.duty = 0; this.seq = 0;
    this.period = 0; this.timer = 0;
    this.length = 0; this.halt = false;
    this.sweepEnabled = false; this.sweepPeriod = 0; this.sweepNegate = false; this.sweepShift = 0;
    this.sweepReload = false; this.sweepDivider = 0;
  }
  write(reg, v) {
    switch (reg) {
      case 0:
        this.duty = v >> 6;
        this.halt = this.env.loop = (v & 0x20) !== 0;
        this.env.constant = (v & 0x10) !== 0;
        this.env.volume = v & 0x0f;
        break;
      case 1:
        this.sweepEnabled = (v & 0x80) !== 0;
        this.sweepPeriod = (v >> 4) & 7;
        this.sweepNegate = (v & 0x08) !== 0;
        this.sweepShift = v & 7;
        this.sweepReload = true;
        break;
      case 2:
        this.period = (this.period & 0x700) | v;
        break;
      case 3:
        this.period = (this.period & 0xff) | ((v & 7) << 8);
        if (this.enabled) this.length = LENGTH_TABLE[v >> 3];
        this.seq = 0;
        this.env.start = true;
        break;
    }
  }
  targetPeriod() {
    const change = this.period >> this.sweepShift;
    if (this.sweepNegate) return this.period - change - (this.channel === 1 ? 1 : 0);
    return this.period + change;
  }
  muted() { return this.period < 8 || this.targetPeriod() > 0x7ff; }
  clockTimer() {
    if (this.timer === 0) {
      this.timer = this.period;
      this.seq = (this.seq + 1) & 7;
    } else {
      this.timer--;
    }
  }
  clockSweep() {
    if (this.sweepDivider === 0 && this.sweepEnabled && this.sweepShift > 0 && !this.muted()) {
      const t = this.targetPeriod();
      this.period = t < 0 ? 0 : t;
    }
    if (this.sweepDivider === 0 || this.sweepReload) {
      this.sweepDivider = this.sweepPeriod;
      this.sweepReload = false;
    } else {
      this.sweepDivider--;
    }
  }
  clockLength() { if (!this.halt && this.length > 0) this.length--; }
  output() {
    if (this.length === 0 || this.muted() || !DUTY[this.duty][this.seq]) return 0;
    return this.env.output();
  }
}

class Triangle {
  constructor() {
    this.enabled = false;
    this.period = 0; this.timer = 0; this.seq = 0;
    this.length = 0; this.control = false;
    this.linear = 0; this.linearReload = 0; this.linearReloadFlag = false;
  }
  write(reg, v) {
    switch (reg) {
      case 0:
        this.control = (v & 0x80) !== 0;
        this.linearReload = v & 0x7f;
        break;
      case 2:
        this.period = (this.period & 0x700) | v;
        break;
      case 3:
        this.period = (this.period & 0xff) | ((v & 7) << 8);
        if (this.enabled) this.length = LENGTH_TABLE[v >> 3];
        this.linearReloadFlag = true;
        break;
    }
  }
  clockTimer() {
    if (this.timer === 0) {
      this.timer = this.period;
      // Ultrasonic periods (< 2) are silenced instead of producing a DC pop.
      if (this.length > 0 && this.linear > 0 && this.period >= 2) this.seq = (this.seq + 1) & 31;
    } else {
      this.timer--;
    }
  }
  clockLinear() {
    if (this.linearReloadFlag) this.linear = this.linearReload;
    else if (this.linear > 0) this.linear--;
    if (!this.control) this.linearReloadFlag = false;
  }
  clockLength() { if (!this.control && this.length > 0) this.length--; }
  output() { return TRIANGLE[this.seq]; }
}

class Noise {
  constructor() {
    this.enabled = false;
    this.env = new Envelope();
    this.mode = false;
    this.period = NOISE_PERIOD[0]; this.timer = 0;
    this.shift = 1;
    this.length = 0; this.halt = false;
  }
  write(reg, v) {
    switch (reg) {
      case 0:
        this.halt = this.env.loop = (v & 0x20) !== 0;
        this.env.constant = (v & 0x10) !== 0;
        this.env.volume = v & 0x0f;
        break;
      case 2:
        this.mode = (v & 0x80) !== 0;
        this.period = NOISE_PERIOD[v & 0x0f];
        break;
      case 3:
        if (this.enabled) this.length = LENGTH_TABLE[v >> 3];
        this.env.start = true;
        break;
    }
  }
  clockTimer() {
    if (this.timer === 0) {
      this.timer = this.period - 1;
      const fb = (this.shift & 1) ^ ((this.shift >> (this.mode ? 6 : 1)) & 1);
      this.shift = (this.shift >> 1) | (fb << 14);
    } else {
      this.timer--;
    }
  }
  clockLength() { if (!this.halt && this.length > 0) this.length--; }
  output() {
    if (this.length === 0 || (this.shift & 1)) return 0;
    return this.env.output();
  }
}

class DMC {
  constructor(apu) {
    this.apu = apu;
    this.irqEnabled = false; this.loop = false;
    this.rate = DMC_RATE[0]; this.timer = DMC_RATE[0];
    this.level = 0;
    this.sampleAddr = 0xc000; this.sampleLength = 1;
    this.addr = 0xc000; this.remaining = 0;
    this.buffer = 0; this.bufferEmpty = true;
    this.shift = 0; this.bits = 8; this.silence = true;
    this.irqFlag = false;
  }
  write(reg, v) {
    switch (reg) {
      case 0:
        this.irqEnabled = (v & 0x80) !== 0;
        this.loop = (v & 0x40) !== 0;
        this.rate = DMC_RATE[v & 0x0f];
        if (!this.irqEnabled) { this.irqFlag = false; this.apu.nes.cpu.setIrq(IRQ_DMC, false); }
        break;
      case 1: this.level = v & 0x7f; break;
      case 2: this.sampleAddr = 0xc000 | (v << 6); break;
      case 3: this.sampleLength = (v << 4) | 1; break;
    }
  }
  restart() {
    this.addr = this.sampleAddr;
    this.remaining = this.sampleLength;
  }
  fill() {
    if (!this.bufferEmpty || this.remaining === 0) return;
    this.buffer = this.apu.nes.dmcRead(this.addr);
    this.bufferEmpty = false;
    this.addr = this.addr === 0xffff ? 0x8000 : this.addr + 1;
    if (--this.remaining === 0) {
      if (this.loop) this.restart();
      else if (this.irqEnabled) { this.irqFlag = true; this.apu.nes.cpu.setIrq(IRQ_DMC, true); }
    }
  }
  clockTimer() {
    if (--this.timer > 0) return;
    this.timer = this.rate;
    if (!this.silence) {
      if (this.shift & 1) { if (this.level <= 125) this.level += 2; }
      else if (this.level >= 2) this.level -= 2;
    }
    this.shift >>= 1;
    if (--this.bits === 0) {
      this.bits = 8;
      if (this.bufferEmpty) {
        this.silence = true;
      } else {
        this.silence = false;
        this.shift = this.buffer;
        this.bufferEmpty = true;
        this.fill();
      }
    }
  }
}

export class APU {
  constructor(nes, sampleRate = 44100) {
    this.nes = nes;
    this.pulse1 = new Pulse(1);
    this.pulse2 = new Pulse(2);
    this.triangle = new Triangle();
    this.noise = new Noise();
    this.dmc = new DMC(this);
    this.frameMode = 0;
    this.irqInhibit = false;
    this.frameIrq = false;
    this.frameCycle = 0;
    this.frameResetDelay = 0;
    this.oddCycle = false;
    // Output
    this.setSampleRate(sampleRate);
    this.sampleBuffer = new Float32Array(8192);
    this.sampleCount = 0;
    this.accum = 0; this.accumN = 0;
    this.hp1x = 0; this.hp1y = 0; this.hp2x = 0; this.hp2y = 0; this.lpy = 0;
  }

  setSampleRate(rate) {
    this.sampleRate = rate;
    this.rateAdjust = 1;
    this.sampleClock = 0;
    const dt = 1 / rate;
    const rc = (f) => 1 / (2 * Math.PI * f);
    this.hp1a = rc(90) / (rc(90) + dt);
    this.hp2a = rc(440) / (rc(440) + dt);
    this.lpa = dt / (rc(14000) + dt);
  }

  reset() {
    this.writeRegister(0x4015, 0);
    this.frameCycle = 0;
    this.frameIrq = false;
    this.nes.cpu.setIrq(IRQ_APU_FRAME, false);
    this.dmc.irqFlag = false;
    this.nes.cpu.setIrq(IRQ_DMC, false);
  }

  writeRegister(addr, v) {
    if (addr < 0x4004) this.pulse1.write(addr & 3, v);
    else if (addr < 0x4008) this.pulse2.write(addr & 3, v);
    else if (addr < 0x400c) this.triangle.write(addr & 3, v);
    else if (addr < 0x4010) this.noise.write(addr & 3, v);
    else if (addr < 0x4014) this.dmc.write(addr & 3, v);
    else if (addr === 0x4015) {
      const chans = [this.pulse1, this.pulse2, this.triangle, this.noise];
      chans.forEach((c, i) => {
        c.enabled = ((v >> i) & 1) !== 0;
        if (!c.enabled) c.length = 0;
      });
      this.dmc.irqFlag = false;
      this.nes.cpu.setIrq(IRQ_DMC, false);
      if (v & 0x10) {
        if (this.dmc.remaining === 0) this.dmc.restart();
        this.dmc.fill(); // the DMA happens right after the write
      } else {
        this.dmc.remaining = 0;
      }
    } else if (addr === 0x4017) {
      this.frameMode = v >> 7;
      this.irqInhibit = (v & 0x40) !== 0;
      if (this.irqInhibit) { this.frameIrq = false; this.nes.cpu.setIrq(IRQ_APU_FRAME, false); }
      this.frameResetDelay = this.oddCycle ? 4 : 3;
    }
  }

  readStatus() {
    let v = 0;
    if (this.pulse1.length > 0) v |= 1;
    if (this.pulse2.length > 0) v |= 2;
    if (this.triangle.length > 0) v |= 4;
    if (this.noise.length > 0) v |= 8;
    if (this.dmc.remaining > 0) v |= 0x10;
    if (this.frameIrq) v |= 0x40;
    if (this.dmc.irqFlag) v |= 0x80;
    this.frameIrq = false;
    this.nes.cpu.setIrq(IRQ_APU_FRAME, false);
    return v;
  }

  quarterFrame() {
    this.pulse1.env.clock();
    this.pulse2.env.clock();
    this.noise.env.clock();
    this.triangle.clockLinear();
  }

  halfFrame() {
    this.pulse1.clockLength(); this.pulse1.clockSweep();
    this.pulse2.clockLength(); this.pulse2.clockSweep();
    this.triangle.clockLength();
    this.noise.clockLength();
  }

  setFrameIrq() {
    if (!this.irqInhibit) {
      this.frameIrq = true;
      this.nes.cpu.setIrq(IRQ_APU_FRAME, true);
    }
  }

  stepFrameCounter() {
    if (this.frameResetDelay > 0 && --this.frameResetDelay === 0) {
      this.frameCycle = 0;
      if (this.frameMode === 1) { this.quarterFrame(); this.halfFrame(); }
      return;
    }
    const c = ++this.frameCycle;
    if (c === 7457 || c === 22371) {
      this.quarterFrame();
    } else if (c === 14913) {
      this.quarterFrame(); this.halfFrame();
    } else if (this.frameMode === 0) {
      if (c === 29828) this.setFrameIrq();
      else if (c === 29829) { this.quarterFrame(); this.halfFrame(); this.setFrameIrq(); }
      else if (c >= 29830) { this.setFrameIrq(); this.frameCycle = 0; }
    } else {
      if (c === 37281) { this.quarterFrame(); this.halfFrame(); }
      else if (c >= 37282) this.frameCycle = 0;
    }
  }

  // Called once per CPU cycle.
  step() {
    this.stepFrameCounter();
    this.oddCycle = !this.oddCycle;
    if (this.oddCycle) {
      this.pulse1.clockTimer();
      this.pulse2.clockTimer();
    }
    this.noise.clockTimer();
    this.triangle.clockTimer();
    this.dmc.clockTimer();

    const out = PULSE_MIX[this.pulse1.output() + this.pulse2.output()] +
      TND_MIX[3 * this.triangle.output() + 2 * this.noise.output() + this.dmc.level];
    this.accum += out;
    this.accumN++;
    this.sampleClock += this.sampleRate * this.rateAdjust;
    if (this.sampleClock >= CPU_HZ) {
      this.sampleClock -= CPU_HZ;
      this.emitSample(this.accum / this.accumN);
      this.accum = 0;
      this.accumN = 0;
    }
  }

  emitSample(x) {
    // Approximate the NES output stage: two high-pass and one low-pass filter.
    const h1 = this.hp1a * (this.hp1y + x - this.hp1x);
    this.hp1x = x; this.hp1y = h1;
    const h2 = this.hp2a * (this.hp2y + h1 - this.hp2x);
    this.hp2x = h1; this.hp2y = h2;
    this.lpy += this.lpa * (h2 - this.lpy);
    if (this.sampleCount < this.sampleBuffer.length) this.sampleBuffer[this.sampleCount++] = this.lpy;
  }

  // Hand the samples produced since the last call to the audio backend.
  takeSamples() {
    const out = this.sampleBuffer.slice(0, this.sampleCount);
    this.sampleCount = 0;
    return out;
  }
}
