// Unit tests for the 6502 core against a flat 64 KB memory bus.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CPU, OPCODES, FLAG_C, FLAG_Z, FLAG_I, FLAG_V, FLAG_N, IRQ_MAPPER } from '../src/cpu.js';

class FlatBus {
  constructor() { this.mem = new Uint8Array(0x10000); this.log = []; }
  tickBefore() {}
  tickAfter() {}
  read(a) { this.log.push(['r', a]); return this.mem[a]; }
  write(a, v) { this.log.push(['w', a, v]); this.mem[a] = v; }
}

// Load `bytes` at $0600 and point the CPU at it.
function setup(bytes, regs = {}) {
  const bus = new FlatBus();
  bus.mem.set(bytes, 0x0600);
  const cpu = new CPU(bus);
  cpu.pc = 0x0600;
  cpu.s = 0xfd;
  cpu.p = 0x24;
  Object.assign(cpu, regs);
  bus.log = [];
  return { cpu, bus, mem: bus.mem };
}

function run(bytes, regs, steps = 1) {
  const ctx = setup(bytes, regs);
  let cycles = 0;
  for (let i = 0; i < steps; i++) cycles += ctx.cpu.step();
  return { ...ctx, cycles };
}

describe('opcode table', () => {
  test('defines all 256 opcodes', () => {
    assert.equal(OPCODES.filter(Boolean).length, 256);
    assert.equal(OPCODES.filter((o) => o.official).length, 151);
  });
});

describe('loads and flags', () => {
  test('LDA #imm sets Z and N', () => {
    assert.ok(run([0xa9, 0x00]).cpu.p & FLAG_Z);
    const { cpu } = run([0xa9, 0x80]);
    assert.equal(cpu.a, 0x80);
    assert.ok(cpu.p & FLAG_N);
    assert.ok(!(cpu.p & FLAG_Z));
  });

  test('zero page,X wraps within page zero', () => {
    const ctx = setup([0xb5, 0xf0], { x: 0x20 });
    ctx.mem[0x0010] = 0x42;
    ctx.mem[0x0110] = 0x99;
    ctx.cpu.step();
    assert.equal(ctx.cpu.a, 0x42);
  });

  test('(indirect),Y reads pointer from zero page with wrap', () => {
    const ctx = setup([0xb1, 0xff], { y: 0x10 });
    ctx.mem[0xff] = 0x00;
    ctx.mem[0x00] = 0x20; // pointer high byte wraps to $00
    ctx.mem[0x2010] = 0x77;
    ctx.cpu.step();
    assert.equal(ctx.cpu.a, 0x77);
  });
});

describe('arithmetic', () => {
  const adc = (a, v, c) => run([0x69, v], { a, p: 0x24 | (c ? FLAG_C : 0) }).cpu;
  test('ADC carry and overflow', () => {
    let c = adc(0x50, 0x50, 0);
    assert.equal(c.a, 0xa0); assert.ok(c.p & FLAG_V); assert.ok(!(c.p & FLAG_C));
    c = adc(0xff, 0x01, 0);
    assert.equal(c.a, 0x00); assert.ok(c.p & FLAG_C); assert.ok(c.p & FLAG_Z); assert.ok(!(c.p & FLAG_V));
    c = adc(0x01, 0x01, 1);
    assert.equal(c.a, 0x03);
  });

  test('SBC borrows through carry', () => {
    let c = run([0xe9, 0x01], { a: 0x00, p: 0x24 | FLAG_C }).cpu;
    assert.equal(c.a, 0xff); assert.ok(!(c.p & FLAG_C)); assert.ok(c.p & FLAG_N);
    c = run([0xe9, 0x01], { a: 0x80, p: 0x24 | FLAG_C }).cpu;
    assert.equal(c.a, 0x7f); assert.ok(c.p & FLAG_V);
  });

  test('decimal flag is ignored by ADC (2A03 has no BCD)', () => {
    const c = run([0x69, 0x01], { a: 0x09, p: 0x2c }).cpu;
    assert.equal(c.a, 0x0a);
  });

  test('CMP sets carry when A >= M', () => {
    let c = run([0xc9, 0x10], { a: 0x10 }).cpu;
    assert.ok(c.p & FLAG_C); assert.ok(c.p & FLAG_Z);
    c = run([0xc9, 0x20], { a: 0x10 }).cpu;
    assert.ok(!(c.p & FLAG_C)); assert.ok(c.p & FLAG_N);
  });

  test('BIT copies bits 7/6 into N/V', () => {
    const ctx = setup([0x24, 0x10], { a: 0x01 });
    ctx.mem[0x10] = 0xc0;
    ctx.cpu.step();
    assert.ok(ctx.cpu.p & FLAG_N); assert.ok(ctx.cpu.p & FLAG_V); assert.ok(ctx.cpu.p & FLAG_Z);
  });

  test('ROR through carry on memory', () => {
    const ctx = setup([0x66, 0x10], { p: 0x24 | FLAG_C });
    ctx.mem[0x10] = 0x01;
    ctx.cpu.step();
    assert.equal(ctx.mem[0x10], 0x80);
    assert.ok(ctx.cpu.p & FLAG_C);
  });
});

describe('cycle timing', () => {
  const cases = [
    ['LDA #imm', [0xa9, 0], {}, 2],
    ['LDA zp', [0xa5, 0], {}, 3],
    ['LDA zp,X', [0xb5, 0], {}, 4],
    ['LDA abs', [0xad, 0, 0x20], {}, 4],
    ['LDA abs,X no cross', [0xbd, 0x00, 0x20], { x: 1 }, 4],
    ['LDA abs,X page cross', [0xbd, 0xff, 0x20], { x: 1 }, 5],
    ['STA abs,X always 5', [0x9d, 0x00, 0x20], { x: 1 }, 5],
    ['LDA (zp,X)', [0xa1, 0], {}, 6],
    ['LDA (zp),Y cross', [0xb1, 0x40], { y: 0xff }, 6],
    ['INC abs,X', [0xfe, 0, 0x20], {}, 7],
    ['JSR', [0x20, 0, 0x07], {}, 6],
    ['PHA', [0x48], {}, 3],
    ['PLA', [0x68], {}, 4],
    ['BRK', [0x00], {}, 7],
    ['JMP (ind)', [0x6c, 0, 0x02], {}, 5],
    ['branch not taken', [0xd0, 0x10], { p: 0x26 }, 2],
    ['branch taken', [0xd0, 0x10], { p: 0x24 }, 3],
    ['branch taken page cross', [0xd0, 0xf0], { p: 0x24 }, 4],
    ['DCP (zp),Y (unofficial)', [0xd3, 0x40], {}, 8],
    ['NOP abs,X cross (unofficial)', [0x1c, 0xff, 0x20], { x: 1 }, 5],
  ];
  for (const [name, bytes, regs, cycles] of cases) {
    test(`${name} takes ${cycles} cycles`, () => {
      const ctx = setup(bytes, regs);
      ctx.mem[0x40] = 0x80; ctx.mem[0x41] = 0x20;
      assert.equal(ctx.cpu.step(), cycles);
    });
  }

  test('STA abs,X performs a dummy read at the un-carried address', () => {
    const { bus } = run([0x9d, 0xff, 0x20], { x: 1 });
    assert.deepEqual(bus.log[3], ['r', 0x2000]);
    assert.deepEqual(bus.log[4], ['w', 0x2100, 0]);
  });

  test('read-modify-write writes the old value first', () => {
    const ctx = setup([0xee, 0x00, 0x20]);
    ctx.mem[0x2000] = 0x41;
    ctx.cpu.step();
    const writes = ctx.bus.log.filter((e) => e[0] === 'w');
    assert.deepEqual(writes, [['w', 0x2000, 0x41], ['w', 0x2000, 0x42]]);
  });
});

describe('control flow', () => {
  test('JMP indirect reproduces the page-wrap bug', () => {
    const ctx = setup([0x6c, 0xff, 0x02]);
    ctx.mem[0x02ff] = 0x34;
    ctx.mem[0x0200] = 0x12; // not $0300
    ctx.mem[0x0300] = 0x99;
    ctx.cpu.step();
    assert.equal(ctx.cpu.pc, 0x1234);
  });

  test('JSR / RTS round trip', () => {
    const ctx = setup([0x20, 0x00, 0x07, 0xea]);
    ctx.mem[0x0700] = 0x60; // RTS
    ctx.cpu.step();
    assert.equal(ctx.cpu.pc, 0x0700);
    assert.equal(ctx.mem[0x01fd], 0x06);
    assert.equal(ctx.mem[0x01fc], 0x02);
    ctx.cpu.step();
    assert.equal(ctx.cpu.pc, 0x0603);
    assert.equal(ctx.cpu.s, 0xfd);
  });

  test('BRK pushes B flag and RTI restores', () => {
    const ctx = setup([0x00, 0xff], { p: 0x20 });
    ctx.mem[0xfffe] = 0x00; ctx.mem[0xffff] = 0x08;
    ctx.mem[0x0800] = 0x40; // RTI
    ctx.cpu.step();
    assert.equal(ctx.cpu.pc, 0x0800);
    assert.equal(ctx.mem[0x01fb] & 0x30, 0x30);
    assert.ok(ctx.cpu.p & FLAG_I);
    ctx.cpu.step();
    assert.equal(ctx.cpu.pc, 0x0602);
    assert.ok(!(ctx.cpu.p & FLAG_I));
  });

  test('PLP ignores the B flag and keeps bit 5 set', () => {
    const ctx = setup([0x28]);
    ctx.mem[0x01fe] = 0xff;
    ctx.cpu.step();
    assert.equal(ctx.cpu.p, 0xef);
  });
});

describe('interrupts', () => {
  test('NMI is serviced after the current instruction', () => {
    const ctx = setup([0xea, 0xea]);
    ctx.mem[0xfffa] = 0x00; ctx.mem[0xfffb] = 0x09;
    ctx.cpu.triggerNmi();
    const cycles = ctx.cpu.step();
    assert.equal(cycles, 2 + 7);
    assert.equal(ctx.cpu.pc, 0x0900);
    assert.equal(ctx.mem[0x01fb] & 0x10, 0, 'B flag clear on hardware interrupts');
  });

  test('IRQ is masked by I and delayed one instruction after CLI', () => {
    const ctx = setup([0x58, 0xea, 0xea], { p: 0x24 });
    ctx.mem[0xfffe] = 0x00; ctx.mem[0xffff] = 0x0a;
    ctx.cpu.setIrq(IRQ_MAPPER, true);
    ctx.cpu.step(); // CLI: IRQ not taken yet
    assert.equal(ctx.cpu.pc, 0x0601);
    ctx.cpu.step(); // NOP, then IRQ
    assert.equal(ctx.cpu.pc, 0x0a00);
  });
});

describe('unofficial opcodes', () => {
  test('LAX loads A and X', () => {
    const ctx = setup([0xa7, 0x10]);
    ctx.mem[0x10] = 0x5a;
    ctx.cpu.step();
    assert.equal(ctx.cpu.a, 0x5a); assert.equal(ctx.cpu.x, 0x5a);
  });
  test('SAX stores A & X', () => {
    const { mem } = run([0x87, 0x10], { a: 0xf0, x: 0x3c });
    assert.equal(mem[0x10], 0x30);
  });
  test('ISB increments then subtracts', () => {
    const ctx = setup([0xe7, 0x10], { a: 0x10, p: 0x25 });
    ctx.mem[0x10] = 0x04;
    ctx.cpu.step();
    assert.equal(ctx.mem[0x10], 0x05); assert.equal(ctx.cpu.a, 0x0b);
  });
  test('AXS (SBX) computes (A & X) - imm into X', () => {
    const c = run([0xcb, 0x01], { a: 0xff, x: 0x0f }).cpu;
    assert.equal(c.x, 0x0e); assert.ok(c.p & FLAG_C);
  });
  test('JAM halts the CPU', () => {
    const c = run([0x02, 0xea], {}, 3).cpu;
    assert.ok(c.jammed);
    assert.equal(c.pc, 0x0600);
  });
});
