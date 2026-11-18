// Ricoh 2A03 CPU core (MOS 6502 without decimal mode).
//
// Every bus access costs exactly one CPU cycle: `read()` / `write()` call
// `bus.tick()` first, which advances the PPU by 3 dots and the APU by one
// cycle. Addressing modes perform the same dummy reads/writes as the real
// chip, so instruction timing (including page-crossing penalties) emerges
// naturally from the access pattern instead of from a cycle table.

export const FLAG_C = 0x01;
export const FLAG_Z = 0x02;
export const FLAG_I = 0x04;
export const FLAG_D = 0x08;
export const FLAG_B = 0x10;
export const FLAG_U = 0x20;
export const FLAG_V = 0x40;
export const FLAG_N = 0x80;

// IRQ sources (bit mask in cpu.irqLine)
export const IRQ_APU_FRAME = 1;
export const IRQ_DMC = 2;
export const IRQ_MAPPER = 4;

// Addressing modes
const IMP = 0, IMM = 1, ZP = 2, ZPX = 3, ZPY = 4, ABS = 5, ABX = 6, ABY = 7, INX = 8, INY = 9, REL = 10, IND = 11, ACC = 12;
// Instruction kinds
const K_READ = 0, K_WRITE = 1, K_RMW = 2, K_IMPLIED = 3, K_SPECIAL = 4;

export const MODE_NAMES = ['imp', 'imm', 'zp', 'zpx', 'zpy', 'abs', 'abx', 'aby', 'inx', 'iny', 'rel', 'ind', 'acc'];

function setZN(c, v) {
  c.p = (c.p & 0x7d) | (v & 0x80) | (v === 0 ? FLAG_Z : 0);
}

function adc(c, v) {
  const a = c.a;
  const s = a + v + (c.p & FLAG_C);
  c.p = (c.p & ~(FLAG_C | FLAG_V)) | (s > 0xff ? FLAG_C : 0) | ((~(a ^ v) & (a ^ s) & 0x80) ? FLAG_V : 0);
  c.a = s & 0xff;
  setZN(c, c.a);
}
const sbc = (c, v) => adc(c, v ^ 0xff);

function compare(c, r, v) {
  const t = r - v;
  c.p = (c.p & ~FLAG_C) | (t >= 0 ? FLAG_C : 0);
  setZN(c, t & 0xff);
}

function asl(c, v) { c.p = (c.p & ~FLAG_C) | (v >> 7); v = (v << 1) & 0xff; setZN(c, v); return v; }
function lsr(c, v) { c.p = (c.p & ~FLAG_C) | (v & 1); v >>= 1; setZN(c, v); return v; }
function rol(c, v) { const r = ((v << 1) | (c.p & FLAG_C)) & 0xff; c.p = (c.p & ~FLAG_C) | (v >> 7); setZN(c, r); return r; }
function ror(c, v) { const r = (v >> 1) | ((c.p & FLAG_C) << 7); c.p = (c.p & ~FLAG_C) | (v & 1); setZN(c, r); return r; }

// ---------------------------------------------------------------------------
// Opcode table

export const OPCODES = new Array(256);

function def(name, kind, fn, modes) {
  for (const [code, mode] of Object.entries(modes)) {
    OPCODES[Number(code)] = { name, kind, fn, mode, official: true };
  }
}
function undoc(name, kind, fn, modes) {
  for (const [code, mode] of Object.entries(modes)) {
    OPCODES[Number(code)] = { name, kind, fn, mode, official: false };
  }
}

// --- Loads / stores
def('LDA', K_READ, (c, v) => { c.a = v; setZN(c, v); }, { 0xa9: IMM, 0xa5: ZP, 0xb5: ZPX, 0xad: ABS, 0xbd: ABX, 0xb9: ABY, 0xa1: INX, 0xb1: INY });
def('LDX', K_READ, (c, v) => { c.x = v; setZN(c, v); }, { 0xa2: IMM, 0xa6: ZP, 0xb6: ZPY, 0xae: ABS, 0xbe: ABY });
def('LDY', K_READ, (c, v) => { c.y = v; setZN(c, v); }, { 0xa0: IMM, 0xa4: ZP, 0xb4: ZPX, 0xac: ABS, 0xbc: ABX });
def('STA', K_WRITE, (c) => c.a, { 0x85: ZP, 0x95: ZPX, 0x8d: ABS, 0x9d: ABX, 0x99: ABY, 0x81: INX, 0x91: INY });
def('STX', K_WRITE, (c) => c.x, { 0x86: ZP, 0x96: ZPY, 0x8e: ABS });
def('STY', K_WRITE, (c) => c.y, { 0x84: ZP, 0x94: ZPX, 0x8c: ABS });

// --- Arithmetic / logic
def('ADC', K_READ, adc, { 0x69: IMM, 0x65: ZP, 0x75: ZPX, 0x6d: ABS, 0x7d: ABX, 0x79: ABY, 0x61: INX, 0x71: INY });
def('SBC', K_READ, sbc, { 0xe9: IMM, 0xe5: ZP, 0xf5: ZPX, 0xed: ABS, 0xfd: ABX, 0xf9: ABY, 0xe1: INX, 0xf1: INY });
def('AND', K_READ, (c, v) => { c.a &= v; setZN(c, c.a); }, { 0x29: IMM, 0x25: ZP, 0x35: ZPX, 0x2d: ABS, 0x3d: ABX, 0x39: ABY, 0x21: INX, 0x31: INY });
def('ORA', K_READ, (c, v) => { c.a |= v; setZN(c, c.a); }, { 0x09: IMM, 0x05: ZP, 0x15: ZPX, 0x0d: ABS, 0x1d: ABX, 0x19: ABY, 0x01: INX, 0x11: INY });
def('EOR', K_READ, (c, v) => { c.a ^= v; setZN(c, c.a); }, { 0x49: IMM, 0x45: ZP, 0x55: ZPX, 0x4d: ABS, 0x5d: ABX, 0x59: ABY, 0x41: INX, 0x51: INY });
def('CMP', K_READ, (c, v) => compare(c, c.a, v), { 0xc9: IMM, 0xc5: ZP, 0xd5: ZPX, 0xcd: ABS, 0xdd: ABX, 0xd9: ABY, 0xc1: INX, 0xd1: INY });
def('CPX', K_READ, (c, v) => compare(c, c.x, v), { 0xe0: IMM, 0xe4: ZP, 0xec: ABS });
def('CPY', K_READ, (c, v) => compare(c, c.y, v), { 0xc0: IMM, 0xc4: ZP, 0xcc: ABS });
def('BIT', K_READ, (c, v) => {
  c.p = (c.p & 0x3d) | (v & 0xc0) | ((c.a & v) === 0 ? FLAG_Z : 0);
}, { 0x24: ZP, 0x2c: ABS });

// --- Read-modify-write
def('ASL', K_RMW, asl, { 0x06: ZP, 0x16: ZPX, 0x0e: ABS, 0x1e: ABX });
def('LSR', K_RMW, lsr, { 0x46: ZP, 0x56: ZPX, 0x4e: ABS, 0x5e: ABX });
def('ROL', K_RMW, rol, { 0x26: ZP, 0x36: ZPX, 0x2e: ABS, 0x3e: ABX });
def('ROR', K_RMW, ror, { 0x66: ZP, 0x76: ZPX, 0x6e: ABS, 0x7e: ABX });
def('INC', K_RMW, (c, v) => { v = (v + 1) & 0xff; setZN(c, v); return v; }, { 0xe6: ZP, 0xf6: ZPX, 0xee: ABS, 0xfe: ABX });
def('DEC', K_RMW, (c, v) => { v = (v - 1) & 0xff; setZN(c, v); return v; }, { 0xc6: ZP, 0xd6: ZPX, 0xce: ABS, 0xde: ABX });

// --- Accumulator shifts (implied timing)
def('ASL', K_IMPLIED, (c) => { c.a = asl(c, c.a); }, { 0x0a: ACC });
def('LSR', K_IMPLIED, (c) => { c.a = lsr(c, c.a); }, { 0x4a: ACC });
def('ROL', K_IMPLIED, (c) => { c.a = rol(c, c.a); }, { 0x2a: ACC });
def('ROR', K_IMPLIED, (c) => { c.a = ror(c, c.a); }, { 0x6a: ACC });

// --- Register transfers / inc / dec / flags
def('TAX', K_IMPLIED, (c) => { c.x = c.a; setZN(c, c.x); }, { 0xaa: IMP });
def('TAY', K_IMPLIED, (c) => { c.y = c.a; setZN(c, c.y); }, { 0xa8: IMP });
def('TXA', K_IMPLIED, (c) => { c.a = c.x; setZN(c, c.a); }, { 0x8a: IMP });
def('TYA', K_IMPLIED, (c) => { c.a = c.y; setZN(c, c.a); }, { 0x98: IMP });
def('TSX', K_IMPLIED, (c) => { c.x = c.s; setZN(c, c.x); }, { 0xba: IMP });
def('TXS', K_IMPLIED, (c) => { c.s = c.x; }, { 0x9a: IMP });
def('INX', K_IMPLIED, (c) => { c.x = (c.x + 1) & 0xff; setZN(c, c.x); }, { 0xe8: IMP });
def('INY', K_IMPLIED, (c) => { c.y = (c.y + 1) & 0xff; setZN(c, c.y); }, { 0xc8: IMP });
def('DEX', K_IMPLIED, (c) => { c.x = (c.x - 1) & 0xff; setZN(c, c.x); }, { 0xca: IMP });
def('DEY', K_IMPLIED, (c) => { c.y = (c.y - 1) & 0xff; setZN(c, c.y); }, { 0x88: IMP });
def('CLC', K_IMPLIED, (c) => { c.p &= ~FLAG_C; }, { 0x18: IMP });
def('SEC', K_IMPLIED, (c) => { c.p |= FLAG_C; }, { 0x38: IMP });
def('CLI', K_IMPLIED, (c) => { c.p &= ~FLAG_I; }, { 0x58: IMP });
def('SEI', K_IMPLIED, (c) => { c.p |= FLAG_I; }, { 0x78: IMP });
def('CLV', K_IMPLIED, (c) => { c.p &= ~FLAG_V; }, { 0xb8: IMP });
def('CLD', K_IMPLIED, (c) => { c.p &= ~FLAG_D; }, { 0xd8: IMP });
def('SED', K_IMPLIED, (c) => { c.p |= FLAG_D; }, { 0xf8: IMP });
def('NOP', K_IMPLIED, () => {}, { 0xea: IMP });

// --- Stack
def('PHA', K_IMPLIED, (c) => c.push(c.a), { 0x48: IMP });
def('PHP', K_IMPLIED, (c) => c.push(c.p | FLAG_B | FLAG_U), { 0x08: IMP });
def('PLA', K_IMPLIED, (c) => { c.read(0x100 | c.s); c.a = c.pull(); setZN(c, c.a); }, { 0x68: IMP });
def('PLP', K_IMPLIED, (c) => { c.read(0x100 | c.s); c.p = (c.pull() & ~FLAG_B) | FLAG_U; }, { 0x28: IMP });

// --- Control flow (special: handle all their own bus cycles)
function branch(flag, set) {
  return (c) => {
    const off = c.read(c.pc);
    c.pc = (c.pc + 1) & 0xffff;
    if (((c.p & flag) !== 0) === set) {
      c.read(c.pc);
      const np = (c.pc + ((off ^ 0x80) - 0x80)) & 0xffff;
      if ((np ^ c.pc) & 0xff00) c.read((c.pc & 0xff00) | (np & 0xff));
      c.pc = np;
    }
  };
}
def('BPL', K_SPECIAL, branch(FLAG_N, false), { 0x10: REL });
def('BMI', K_SPECIAL, branch(FLAG_N, true), { 0x30: REL });
def('BVC', K_SPECIAL, branch(FLAG_V, false), { 0x50: REL });
def('BVS', K_SPECIAL, branch(FLAG_V, true), { 0x70: REL });
def('BCC', K_SPECIAL, branch(FLAG_C, false), { 0x90: REL });
def('BCS', K_SPECIAL, branch(FLAG_C, true), { 0xb0: REL });
def('BNE', K_SPECIAL, branch(FLAG_Z, false), { 0xd0: REL });
def('BEQ', K_SPECIAL, branch(FLAG_Z, true), { 0xf0: REL });

def('JMP', K_SPECIAL, (c) => {
  const lo = c.read(c.pc);
  const hi = c.read((c.pc + 1) & 0xffff);
  c.pc = (hi << 8) | lo;
}, { 0x4c: ABS });
def('JMP', K_SPECIAL, (c) => {
  const plo = c.read(c.pc);
  const phi = c.read((c.pc + 1) & 0xffff);
  const ptr = (phi << 8) | plo;
  const lo = c.read(ptr);
  const hi = c.read((ptr & 0xff00) | ((ptr + 1) & 0xff)); // page-wrap bug
  c.pc = (hi << 8) | lo;
}, { 0x6c: IND });
def('JSR', K_SPECIAL, (c) => {
  const lo = c.read(c.pc);
  c.pc = (c.pc + 1) & 0xffff;
  c.read(0x100 | c.s);
  c.push(c.pc >> 8);
  c.push(c.pc & 0xff);
  const hi = c.read(c.pc);
  c.pc = (hi << 8) | lo;
}, { 0x20: ABS });
def('RTS', K_SPECIAL, (c) => {
  c.read(c.pc);
  c.read(0x100 | c.s);
  const lo = c.pull();
  const hi = c.pull();
  c.pc = (hi << 8) | lo;
  c.read(c.pc);
  c.pc = (c.pc + 1) & 0xffff;
}, { 0x60: IMP });
def('RTI', K_SPECIAL, (c) => {
  c.read(c.pc);
  c.read(0x100 | c.s);
  c.p = (c.pull() & ~FLAG_B) | FLAG_U;
  const lo = c.pull();
  const hi = c.pull();
  c.pc = (hi << 8) | lo;
}, { 0x40: IMP });
def('BRK', K_SPECIAL, (c) => {
  c.read(c.pc);
  c.pc = (c.pc + 1) & 0xffff;
  c.push(c.pc >> 8);
  c.push(c.pc & 0xff);
  const nmi = c.nmiPending; // NMI can hijack the BRK vector
  c.push(c.p | FLAG_B | FLAG_U);
  c.p |= FLAG_I;
  let vec = 0xfffe;
  if (nmi) { c.nmiPending = false; vec = 0xfffa; }
  const lo = c.read(vec);
  const hi = c.read(vec + 1);
  c.pc = (hi << 8) | lo;
}, { 0x00: IMP });

// ---------------------------------------------------------------------------
// Unofficial opcodes

undoc('NOP', K_IMPLIED, () => {}, { 0x1a: IMP, 0x3a: IMP, 0x5a: IMP, 0x7a: IMP, 0xda: IMP, 0xfa: IMP });
undoc('NOP', K_READ, () => {}, {
  0x80: IMM, 0x82: IMM, 0x89: IMM, 0xc2: IMM, 0xe2: IMM,
  0x04: ZP, 0x44: ZP, 0x64: ZP,
  0x14: ZPX, 0x34: ZPX, 0x54: ZPX, 0x74: ZPX, 0xd4: ZPX, 0xf4: ZPX,
  0x0c: ABS,
  0x1c: ABX, 0x3c: ABX, 0x5c: ABX, 0x7c: ABX, 0xdc: ABX, 0xfc: ABX,
});
undoc('LAX', K_READ, (c, v) => { c.a = c.x = v; setZN(c, v); }, { 0xa7: ZP, 0xb7: ZPY, 0xaf: ABS, 0xbf: ABY, 0xa3: INX, 0xb3: INY });
// LXA #imm is unstable on real hardware; the common "magic = $FF" model is used.
undoc('LXA', K_READ, (c, v) => { c.a = c.x = v; setZN(c, v); }, { 0xab: IMM });
undoc('SAX', K_WRITE, (c) => c.a & c.x, { 0x87: ZP, 0x97: ZPY, 0x8f: ABS, 0x83: INX });
undoc('SBC', K_READ, sbc, { 0xeb: IMM });
undoc('DCP', K_RMW, (c, v) => { v = (v - 1) & 0xff; compare(c, c.a, v); return v; }, { 0xc7: ZP, 0xd7: ZPX, 0xcf: ABS, 0xdf: ABX, 0xdb: ABY, 0xc3: INX, 0xd3: INY });
undoc('ISB', K_RMW, (c, v) => { v = (v + 1) & 0xff; sbc(c, v); return v; }, { 0xe7: ZP, 0xf7: ZPX, 0xef: ABS, 0xff: ABX, 0xfb: ABY, 0xe3: INX, 0xf3: INY });
undoc('SLO', K_RMW, (c, v) => { v = asl(c, v); c.a |= v; setZN(c, c.a); return v; }, { 0x07: ZP, 0x17: ZPX, 0x0f: ABS, 0x1f: ABX, 0x1b: ABY, 0x03: INX, 0x13: INY });
undoc('RLA', K_RMW, (c, v) => { v = rol(c, v); c.a &= v; setZN(c, c.a); return v; }, { 0x27: ZP, 0x37: ZPX, 0x2f: ABS, 0x3f: ABX, 0x3b: ABY, 0x23: INX, 0x33: INY });
undoc('SRE', K_RMW, (c, v) => { v = lsr(c, v); c.a ^= v; setZN(c, c.a); return v; }, { 0x47: ZP, 0x57: ZPX, 0x4f: ABS, 0x5f: ABX, 0x5b: ABY, 0x43: INX, 0x53: INY });
undoc('RRA', K_RMW, (c, v) => { v = ror(c, v); adc(c, v); return v; }, { 0x67: ZP, 0x77: ZPX, 0x6f: ABS, 0x7f: ABX, 0x7b: ABY, 0x63: INX, 0x73: INY });
undoc('ANC', K_READ, (c, v) => { c.a &= v; setZN(c, c.a); c.p = (c.p & ~FLAG_C) | (c.a >> 7); }, { 0x0b: IMM, 0x2b: IMM });
undoc('ALR', K_READ, (c, v) => { c.a = lsr(c, c.a & v); }, { 0x4b: IMM });
undoc('ARR', K_READ, (c, v) => {
  const t = c.a & v;
  c.a = (t >> 1) | ((c.p & FLAG_C) << 7);
  setZN(c, c.a);
  const b6 = (c.a >> 6) & 1, b5 = (c.a >> 5) & 1;
  c.p = (c.p & ~(FLAG_C | FLAG_V)) | b6 | ((b6 ^ b5) << 6);
}, { 0x6b: IMM });
undoc('AXS', K_READ, (c, v) => {
  const t = (c.a & c.x) - v;
  c.p = (c.p & ~FLAG_C) | (t >= 0 ? FLAG_C : 0);
  c.x = t & 0xff;
  setZN(c, c.x);
}, { 0xcb: IMM });
// XAA #imm is unstable; magic constant $EE is a commonly observed value.
undoc('XAA', K_READ, (c, v) => { c.a = (c.a | 0xee) & c.x & v; setZN(c, c.a); }, { 0x8b: IMM });
undoc('LAS', K_READ, (c, v) => { c.a = c.x = c.s = v & c.s; setZN(c, c.a); }, { 0xbb: ABY });

// "SH*" stores: value is ANDed with (high byte of base address + 1); when the
// index crosses a page the high byte of the target address is corrupted too.
function shStore(getVal, useY) {
  return (c) => {
    const lo = c.read(c.pc);
    const hi = c.read((c.pc + 1) & 0xffff);
    c.pc = (c.pc + 2) & 0xffff;
    const idx = useY ? c.y : c.x;
    const sum = lo + idx;
    c.read((hi << 8) | (sum & 0xff));
    const val = getVal(c) & ((hi + 1) & 0xff);
    let addr = (((hi << 8) | lo) + idx) & 0xffff;
    if (sum > 0xff) addr = (val << 8) | (addr & 0xff);
    c.write(addr, val);
  };
}
undoc('SHY', K_SPECIAL, shStore((c) => c.y, false), { 0x9c: ABX });
undoc('SHX', K_SPECIAL, shStore((c) => c.x, true), { 0x9e: ABY });
undoc('SHA', K_SPECIAL, shStore((c) => c.a & c.x, true), { 0x9f: ABY });
undoc('TAS', K_SPECIAL, (c) => { c.s = c.a & c.x; shStore((cc) => cc.s, true)(c); }, { 0x9b: ABY });
undoc('SHA', K_SPECIAL, (c) => {
  const zp = c.read(c.pc);
  c.pc = (c.pc + 1) & 0xffff;
  const lo = c.read(zp);
  const hi = c.read((zp + 1) & 0xff);
  const sum = lo + c.y;
  c.read((hi << 8) | (sum & 0xff));
  const val = c.a & c.x & ((hi + 1) & 0xff);
  let addr = (((hi << 8) | lo) + c.y) & 0xffff;
  if (sum > 0xff) addr = (val << 8) | (addr & 0xff);
  c.write(addr, val);
}, { 0x93: INY });

// JAM/KIL: the CPU locks up until reset.
undoc('JAM', K_SPECIAL, (c) => { c.jammed = true; c.pc = (c.pc - 1) & 0xffff; }, {
  0x02: IMP, 0x12: IMP, 0x22: IMP, 0x32: IMP, 0x42: IMP, 0x52: IMP, 0x62: IMP, 0x72: IMP, 0x92: IMP, 0xb2: IMP, 0xd2: IMP, 0xf2: IMP,
});

for (let i = 0; i < 256; i++) {
  if (!OPCODES[i]) throw new Error(`opcode ${i.toString(16)} missing`);
}

// ---------------------------------------------------------------------------

export class CPU {
  constructor(bus) {
    this.bus = bus;
    this.a = 0; this.x = 0; this.y = 0;
    this.s = 0x00; // reset sequence decrements to $FD
    this.p = FLAG_U | FLAG_I;
    this.pc = 0;
    this.cycles = 0;
    this.nmiPending = false;
    this.irqLine = 0;
    this.runIrq = false;
    this.prevRunIrq = false;
    this.stall = 0;
    this.dmaPage = -1;
    this.jammed = false;
  }

  // One CPU cycle elapses on every bus access. The rest of the system runs
  // in two halves around the access (2 PPU dots before, 1 after), and the
  // interrupt lines are sampled at the end of the cycle.
  tick() {
    this.cycles++;
    this.bus.tickBefore();
    this.bus.tickAfter();
    this.poll();
  }

  poll() {
    // The decision to service an interrupt uses the value sampled on the
    // instruction's penultimate cycle.
    this.prevRunIrq = this.runIrq;
    this.runIrq = this.nmiPending || (this.irqLine !== 0 && (this.p & FLAG_I) === 0);
  }

  read(addr) {
    this.cycles++;
    this.bus.tickBefore();
    const v = this.bus.read(addr);
    this.bus.tickAfter();
    this.poll();
    return v;
  }

  write(addr, v) {
    this.cycles++;
    this.bus.tickBefore();
    this.bus.write(addr, v);
    this.bus.tickAfter();
    this.poll();
  }

  push(v) {
    this.write(0x100 | this.s, v);
    this.s = (this.s - 1) & 0xff;
  }

  pull() {
    this.s = (this.s + 1) & 0xff;
    return this.read(0x100 | this.s);
  }

  setIrq(source, active) {
    if (active) this.irqLine |= source;
    else this.irqLine &= ~source;
  }

  triggerNmi() {
    this.nmiPending = true;
  }

  // Power-up / reset sequence: 7 cycles, stack pointer decremented by 3.
  reset() {
    this.jammed = false;
    for (let i = 0; i < 5; i++) this.read(this.pc);
    this.s = (this.s - 3) & 0xff;
    this.p |= FLAG_I;
    const lo = this.read(0xfffc);
    const hi = this.read(0xfffd);
    this.pc = (hi << 8) | lo;
    this.nmiPending = false;
    this.runIrq = this.prevRunIrq = false;
  }

  // Resolve the effective address for a memory operand, performing the dummy
  // reads the real CPU does. `write` forces the extra cycle on indexed modes.
  address(mode, write) {
    let pc = this.pc;
    switch (mode) {
      case IMM:
        this.pc = (pc + 1) & 0xffff;
        return pc;
      case ZP:
        this.pc = (pc + 1) & 0xffff;
        return this.read(pc);
      case ZPX: {
        this.pc = (pc + 1) & 0xffff;
        const z = this.read(pc);
        this.read(z);
        return (z + this.x) & 0xff;
      }
      case ZPY: {
        this.pc = (pc + 1) & 0xffff;
        const z = this.read(pc);
        this.read(z);
        return (z + this.y) & 0xff;
      }
      case ABS: {
        const lo = this.read(pc);
        const hi = this.read((pc + 1) & 0xffff);
        this.pc = (pc + 2) & 0xffff;
        return (hi << 8) | lo;
      }
      case ABX:
      case ABY: {
        const lo = this.read(pc);
        const hi = this.read((pc + 1) & 0xffff);
        this.pc = (pc + 2) & 0xffff;
        const sum = lo + (mode === ABX ? this.x : this.y);
        const addr = ((hi << 8) + sum) & 0xffff;
        if (write || sum > 0xff) this.read((hi << 8) | (sum & 0xff));
        return addr;
      }
      case INX: {
        this.pc = (pc + 1) & 0xffff;
        let z = this.read(pc);
        this.read(z);
        z = (z + this.x) & 0xff;
        const lo = this.read(z);
        const hi = this.read((z + 1) & 0xff);
        return (hi << 8) | lo;
      }
      case INY: {
        this.pc = (pc + 1) & 0xffff;
        const z = this.read(pc);
        const lo = this.read(z);
        const hi = this.read((z + 1) & 0xff);
        const sum = lo + this.y;
        const addr = ((hi << 8) + sum) & 0xffff;
        if (write || sum > 0xff) this.read((hi << 8) | (sum & 0xff));
        return addr;
      }
      default:
        throw new Error('bad addressing mode ' + mode);
    }
  }

  // Execute one instruction (plus any pending DMA / interrupt). Returns the
  // number of CPU cycles consumed.
  step() {
    const start = this.cycles;
    while (this.stall > 0) { this.stall--; this.tick(); }
    if (this.jammed) { this.tick(); return this.cycles - start; }

    const opcode = this.read(this.pc);
    this.pc = (this.pc + 1) & 0xffff;
    const op = OPCODES[opcode];
    switch (op.kind) {
      case K_READ: {
        const addr = this.address(op.mode, false);
        op.fn(this, this.read(addr));
        break;
      }
      case K_WRITE: {
        const addr = this.address(op.mode, true);
        this.write(addr, op.fn(this));
        break;
      }
      case K_RMW: {
        const addr = this.address(op.mode, true);
        let v = this.read(addr);
        this.write(addr, v); // dummy write of the unmodified value
        v = op.fn(this, v);
        this.write(addr, v);
        break;
      }
      case K_IMPLIED:
        this.read(this.pc); // dummy read of the next byte
        op.fn(this);
        break;
      default:
        op.fn(this);
    }

    if (this.dmaPage >= 0) this.oamDma();
    if (this.prevRunIrq) this.interrupt();
    return this.cycles - start;
  }

  // $4014 sprite DMA: 513 or 514 cycles, 256 read/write pairs.
  oamDma() {
    const base = this.dmaPage << 8;
    this.dmaPage = -1;
    this.tick();
    if (this.cycles & 1) this.tick();
    for (let i = 0; i < 256; i++) {
      const v = this.read(base | i);
      this.write(0x2004, v);
    }
  }

  interrupt() {
    this.read(this.pc);
    this.read(this.pc);
    this.push(this.pc >> 8);
    this.push(this.pc & 0xff);
    const nmi = this.nmiPending;
    this.push((this.p & ~FLAG_B) | FLAG_U);
    this.p |= FLAG_I;
    let vec = 0xfffe;
    if (nmi) { this.nmiPending = false; vec = 0xfffa; }
    const lo = this.read(vec);
    const hi = this.read(vec + 1);
    this.pc = (hi << 8) | lo;
  }
}
