// The console: owns the components and implements the CPU memory map.
//
// CPU address space
//   $0000-$1FFF  2 KB internal RAM (mirrored)
//   $2000-$3FFF  PPU registers (mirrored every 8 bytes)
//   $4000-$4017  APU and I/O
//   $4020-$FFFF  cartridge (PRG RAM, PRG ROM, mapper registers)

import { CPU } from './cpu.js';
import { PPU } from './ppu.js';
import { APU } from './apu.js';
import { Controller } from './controller.js';
import { parseINES } from './cartridge.js';
import { createMapper } from './mappers/index.js';
import { snapshot, restore } from './state.js';

export const STATE_VERSION = 1;

export class NES {
  constructor({ sampleRate = 44100 } = {}) {
    this.ram = new Uint8Array(0x800);
    this.cpu = new CPU(this);
    this.ppu = new PPU(this);
    this.apu = new APU(this, sampleRate);
    this.controllers = [new Controller(), new Controller()];
    this.cart = null;
    this.mapper = null;
    this.openBus = 0;
  }

  loadRom(bytes) {
    const cart = parseINES(bytes);
    this.ppu.setMirroring(cart.mirroring);
    const mapper = createMapper(cart, this);
    this.cart = cart;
    this.mapper = mapper;
    this.ppu.attachMapper(mapper);
    this.powerOn();
    return cart;
  }

  powerOn() {
    this.ram.fill(0);
    this.cpu = new CPU(this);
    this.ppu.reset(true);
    this.ppu.oam.fill(0);
    this.ppu.vram.fill(0);
    const rate = this.apu.sampleRate;
    this.apu = new APU(this, rate);
    this.apu.reset();
    this.cpu.reset();
  }

  reset() {
    this.mapper.reset();
    this.ppu.reset(false);
    this.apu.reset();
    this.cpu.reset();
  }

  // One CPU cycle = 3 PPU dots + 1 APU cycle, split around the bus access.
  tickBefore() {
    const ppu = this.ppu;
    ppu.step();
    ppu.step();
  }

  tickAfter() {
    this.ppu.step();
    this.apu.step();
  }

  read(addr) {
    let v;
    if (addr < 0x2000) {
      v = this.ram[addr & 0x7ff];
    } else if (addr < 0x4000) {
      v = this.ppu.readRegister(addr & 7);
    } else if (addr < 0x4020) {
      if (addr === 0x4015) {
        v = this.apu.readStatus(); // does not drive the open-bus latch
        return v | (this.openBus & 0x20);
      } else if (addr === 0x4016 || addr === 0x4017) {
        v = (this.openBus & 0xe0) | this.controllers[addr - 0x4016].read();
      } else {
        v = this.openBus;
      }
    } else {
      v = this.mapper.cpuRead(addr);
      if (v < 0) v = this.openBus;
    }
    this.openBus = v;
    return v;
  }

  write(addr, v) {
    this.openBus = v;
    if (addr < 0x2000) {
      this.ram[addr & 0x7ff] = v;
    } else if (addr < 0x4000) {
      this.ppu.writeRegister(addr & 7, v);
    } else if (addr < 0x4020) {
      if (addr === 0x4014) {
        this.cpu.dmaPage = v;
      } else if (addr === 0x4016) {
        this.controllers[0].write(v);
        this.controllers[1].write(v);
      } else if (addr <= 0x4017) {
        this.apu.writeRegister(addr, v);
      }
    } else {
      this.mapper.cpuWrite(addr, v);
    }
  }

  // DMC sample fetch: steals CPU cycles (approximated as 4).
  dmcRead(addr) {
    this.cpu.stall += 4;
    const v = this.mapper.cpuRead(addr);
    return v < 0 ? this.openBus : v;
  }

  // Run until the PPU enters VBlank (one video frame).
  frame() {
    const ppu = this.ppu;
    const cpu = this.cpu;
    ppu.frameComplete = false;
    // Safety valve: a frame is ~29780 CPU cycles.
    const limit = cpu.cycles + 200000;
    while (!ppu.frameComplete && cpu.cycles < limit) cpu.step();
  }

  setButtons(player, mask) {
    this.controllers[player].setButtons(mask);
  }

  // ---- battery-backed PRG RAM
  get hasBattery() { return !!(this.cart && this.cart.battery); }

  getSram() { return this.mapper ? this.mapper.prgRam : null; }

  setSram(bytes) {
    if (this.mapper && bytes && bytes.length === this.mapper.prgRam.length) this.mapper.prgRam.set(bytes);
  }

  // ---- save states
  saveState() {
    const mapperSkip = ['prgRom'];
    if (!this.mapper.chrIsRam) mapperSkip.push('chr');
    return {
      version: STATE_VERSION,
      crc: this.cart.crc,
      ram: snapshot({ ram: this.ram, openBus: this.openBus }),
      cpu: snapshot(this.cpu),
      ppu: snapshot(this.ppu),
      // Host audio settings (sample rate, filters) stay with the running session.
      apu: snapshot(this.apu, ['sampleRate', 'rateAdjust', 'sampleClock', 'sampleCount', 'hp1a', 'hp2a', 'lpa']),
      mapper: snapshot(this.mapper, mapperSkip),
      controllers: this.controllers.map((c) => snapshot(c)),
    };
  }

  loadState(s) {
    if (!s || s.version !== STATE_VERSION) throw new Error('Incompatible save state');
    if (s.crc !== this.cart.crc) throw new Error('Save state belongs to a different ROM');
    const holder = { ram: this.ram, openBus: 0 };
    restore(holder, s.ram);
    this.openBus = holder.openBus;
    restore(this.cpu, s.cpu);
    restore(this.ppu, s.ppu);
    restore(this.apu, s.apu);
    restore(this.mapper, s.mapper);
    s.controllers.forEach((c, i) => restore(this.controllers[i], c));
    this.ppu.setMirroring(this.ppu.mirroring);
    if (this.mapper.update) this.mapper.update();
  }
}
