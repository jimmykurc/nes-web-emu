// A small two-pass 6502 assembler, enough to build the bundled original games.
//
// Syntax:
//   label:            global label        @loop:   local label (scoped to the last global)
//   NAME = expr       constant
//   .org expr         set the program counter
//   .byte a, "txt"    bytes and strings   .word a, b   little-endian words
//   .asciiz "txt"     string + 0          ; comment
// Operands: #imm  zp/abs  zp,x  abs,y  (ind,x)  (ind),y  (ind)  a (accumulator)
// Expressions: numbers ($hex, %bin, dec, 'c'), symbols, + - * / & | ^ << >>,
// unary - ~ < (low byte) > (high byte), parentheses.

const ALU = (imm, zp, zpx, abs, absx, absy, indx, indy) => ({ imm, zp, zpx, abs, absx, absy, indx, indy });
const SHIFT = (acc, zp, zpx, abs, absx) => ({ acc, zp, zpx, abs, absx });

export const OPCODES = {
  ADC: ALU(0x69, 0x65, 0x75, 0x6d, 0x7d, 0x79, 0x61, 0x71),
  AND: ALU(0x29, 0x25, 0x35, 0x2d, 0x3d, 0x39, 0x21, 0x31),
  CMP: ALU(0xc9, 0xc5, 0xd5, 0xcd, 0xdd, 0xd9, 0xc1, 0xd1),
  EOR: ALU(0x49, 0x45, 0x55, 0x4d, 0x5d, 0x59, 0x41, 0x51),
  LDA: ALU(0xa9, 0xa5, 0xb5, 0xad, 0xbd, 0xb9, 0xa1, 0xb1),
  ORA: ALU(0x09, 0x05, 0x15, 0x0d, 0x1d, 0x19, 0x01, 0x11),
  SBC: ALU(0xe9, 0xe5, 0xf5, 0xed, 0xfd, 0xf9, 0xe1, 0xf1),
  STA: { zp: 0x85, zpx: 0x95, abs: 0x8d, absx: 0x9d, absy: 0x99, indx: 0x81, indy: 0x91 },
  ASL: SHIFT(0x0a, 0x06, 0x16, 0x0e, 0x1e),
  LSR: SHIFT(0x4a, 0x46, 0x56, 0x4e, 0x5e),
  ROL: SHIFT(0x2a, 0x26, 0x36, 0x2e, 0x3e),
  ROR: SHIFT(0x6a, 0x66, 0x76, 0x6e, 0x7e),
  INC: { zp: 0xe6, zpx: 0xf6, abs: 0xee, absx: 0xfe },
  DEC: { zp: 0xc6, zpx: 0xd6, abs: 0xce, absx: 0xde },
  BIT: { zp: 0x24, abs: 0x2c },
  CPX: { imm: 0xe0, zp: 0xe4, abs: 0xec },
  CPY: { imm: 0xc0, zp: 0xc4, abs: 0xcc },
  LDX: { imm: 0xa2, zp: 0xa6, zpy: 0xb6, abs: 0xae, absy: 0xbe },
  LDY: { imm: 0xa0, zp: 0xa4, zpx: 0xb4, abs: 0xac, absx: 0xbc },
  STX: { zp: 0x86, zpy: 0x96, abs: 0x8e },
  STY: { zp: 0x84, zpx: 0x94, abs: 0x8c },
  JMP: { abs: 0x4c, ind: 0x6c },
  JSR: { abs: 0x20 },
};
const IMPLIED = {
  BRK: 0x00, CLC: 0x18, CLD: 0xd8, CLI: 0x58, CLV: 0xb8, DEX: 0xca, DEY: 0x88, INX: 0xe8, INY: 0xc8,
  NOP: 0xea, PHA: 0x48, PHP: 0x08, PLA: 0x68, PLP: 0x28, RTI: 0x40, RTS: 0x60, SEC: 0x38, SED: 0xf8,
  SEI: 0x78, TAX: 0xaa, TAY: 0xa8, TSX: 0xba, TXA: 0x8a, TXS: 0x9a, TYA: 0x98,
};
const BRANCH = { BPL: 0x10, BMI: 0x30, BVC: 0x50, BVS: 0x70, BCC: 0x90, BCS: 0xb0, BNE: 0xd0, BEQ: 0xf0 };
const SIZE = { imp: 1, acc: 1, imm: 2, zp: 2, zpx: 2, zpy: 2, indx: 2, indy: 2, rel: 2, abs: 3, absx: 3, absy: 3, ind: 3 };

class AsmError extends Error {}

// ------------------------------------------------------------ expressions
function tokenize(src) {
  const re = /\s*(\$[0-9a-fA-F]+|%[01]+|\d+|'(?:[^'\\]|\\.)'|[A-Za-z_@.][\w.@]*|<<|>>|[-+*/&|^~<>()])/y;
  const out = [];
  let m;
  re.lastIndex = 0;
  while (re.lastIndex < src.length) {
    if (/^\s*$/.test(src.slice(re.lastIndex))) break;
    const at = re.lastIndex;
    m = re.exec(src);
    if (!m) throw new AsmError(`bad expression near "${src.slice(at)}"`);
    out.push(m[1]);
  }
  return out;
}

function evaluate(src, lookup) {
  const t = tokenize(src);
  let i = 0;
  let unknown = false;
  const peek = () => t[i];
  const primary = () => {
    const tok = t[i++];
    if (tok === undefined) throw new AsmError(`incomplete expression "${src}"`);
    if (tok === '(') { const v = binary(0); if (t[i++] !== ')') throw new AsmError(`missing ) in "${src}"`); return v; }
    if (tok === '-') return -primary();
    if (tok === '~') return ~primary();
    if (tok === '<') return primary() & 0xff;
    if (tok === '>') return (primary() >> 8) & 0xff;
    if (tok[0] === '$') return parseInt(tok.slice(1), 16);
    if (tok[0] === '%') return parseInt(tok.slice(1), 2);
    if (tok[0] === "'") return tok.length === 4 ? tok.charCodeAt(2) : tok.charCodeAt(1);
    if (/^\d/.test(tok)) return parseInt(tok, 10);
    const v = lookup(tok);
    if (v === undefined) { unknown = true; return 0; }
    return v;
  };
  const PREC = { '|': 1, '^': 2, '&': 3, '<<': 4, '>>': 4, '+': 5, '-': 5, '*': 6, '/': 6 };
  const binary = (min) => {
    let left = primary();
    while (PREC[peek()] !== undefined && PREC[peek()] > min) {
      const op = t[i++];
      const right = binary(PREC[op]);
      switch (op) {
        case '|': left |= right; break;
        case '^': left ^= right; break;
        case '&': left &= right; break;
        case '<<': left <<= right; break;
        case '>>': left >>= right; break;
        case '+': left += right; break;
        case '-': left -= right; break;
        case '*': left *= right; break;
        case '/': left = Math.trunc(left / right); break;
      }
    }
    return left;
  };
  const value = binary(0);
  if (i !== t.length) throw new AsmError(`unexpected "${t[i]}" in "${src}"`);
  return unknown ? undefined : value;
}

// ---------------------------------------------------------------- parsing
function splitArgs(s) {
  const out = [];
  let cur = '', q = null;
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"') { q = ch; cur += ch; continue; }
    if (ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function stripComment(line) {
  let q = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === q) q = null; continue; }
    if (ch === '"') q = ch;
    else if (ch === "'" && line[i + 2] === "'") i += 2;
    else if (ch === ';') return line.slice(0, i);
  }
  return line;
}

function parseOperand(op) {
  const s = op.trim();
  if (s === '') return { mode: 'imp' };
  if (/^a$/i.test(s)) return { mode: 'acc' };
  if (s[0] === '#') return { mode: 'imm', expr: s.slice(1) };
  let m;
  if ((m = /^\((.*),\s*x\s*\)$/i.exec(s))) return { mode: 'indx', expr: m[1] };
  if ((m = /^\((.*)\)\s*,\s*y$/i.exec(s))) return { mode: 'indy', expr: m[1] };
  if ((m = /^\((.*)\)$/.exec(s)) && evaluateParensWrapWhole(s)) return { mode: 'ind', expr: m[1] };
  if ((m = /^(.*),\s*x$/i.exec(s))) return { mode: 'x', expr: m[1] };
  if ((m = /^(.*),\s*y$/i.exec(s))) return { mode: 'y', expr: m[1] };
  return { mode: 'addr', expr: s };
}

// "(a)+(b)" is an expression, "(a)" is indirect.
function evaluateParensWrapWhole(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') { depth--; if (depth === 0 && i !== s.length - 1) return false; }
  }
  return true;
}

function parseLines(source) {
  const lines = [];
  source.split(/\r?\n/).forEach((raw, n) => {
    let text = stripComment(raw).trim();
    const line = n + 1;
    let m;
    while ((m = /^([A-Za-z_@][\w@]*):\s*(.*)$/.exec(text))) {
      lines.push({ line, kind: 'label', name: m[1] });
      text = m[2].trim();
    }
    if (!text) return;
    if ((m = /^([A-Za-z_][\w]*)\s*=\s*(.+)$/.exec(text))) { lines.push({ line, kind: 'const', name: m[1], expr: m[2] }); return; }
    if ((m = /^\.(\w+)\s*(.*)$/.exec(text))) { lines.push({ line, kind: 'dir', dir: m[1].toLowerCase(), args: m[2] }); return; }
    m = /^([A-Za-z]{3})\b\s*(.*)$/.exec(text);
    if (!m) throw new AsmError(`line ${line}: cannot parse "${text}"`);
    lines.push({ line, kind: 'op', mnemonic: m[1].toUpperCase(), operand: parseOperand(m[2]) });
  });
  return lines;
}

function decodeString(s) {
  const m = /^"(.*)"$/.exec(s);
  if (!m) return null;
  return [...m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"')].map((c) => c.charCodeAt(0));
}

// --------------------------------------------------------------- assemble
/**
 * @returns {{ bytes: Map<number, number>, symbols: Record<string, number>, start: number, end: number }}
 */
export function assemble(source) {
  const lines = parseLines(source);
  let symbols = {};
  let prev = null;

  for (let pass = 0; pass < 10; pass++) {
    const final = prev !== null && JSON.stringify(prev) === JSON.stringify(symbols);
    const next = {};
    const bytes = new Map();
    let pc = 0, scope = '';
    let lo = Infinity, hi = -Infinity;
    const name = (n) => (n[0] === '@' ? scope + n : n);
    const lookup = (n) => {
      const key = name(n);
      return key in next ? next[key] : symbols[key];
    };
    const ev = (expr, l) => {
      let v;
      try { v = evaluate(expr, lookup); } catch (e) { throw new AsmError(`line ${l.line}: ${e.message}`); }
      if (v === undefined && final) {
        const missing = tokenize(expr).filter((t) => /^[A-Za-z_@]/.test(t) && lookup(t) === undefined);
        throw new AsmError(`line ${l.line}: undefined symbol ${missing.join(', ')}`);
      }
      return v;
    };
    const emit = (b) => { bytes.set(pc, b & 0xff); lo = Math.min(lo, pc); hi = Math.max(hi, pc); pc++; };

    for (const l of lines) {
      if (l.kind === 'label') {
        if (l.name[0] !== '@') scope = l.name;
        const key = name(l.name);
        if (key in next) throw new AsmError(`line ${l.line}: duplicate label ${l.name}`);
        next[key] = pc;
        continue;
      }
      if (l.kind === 'const') {
        const v = ev(l.expr, l);
        if (v !== undefined) next[l.name] = v;
        continue;
      }
      if (l.kind === 'dir') {
        const args = splitArgs(l.args);
        switch (l.dir) {
          case 'org': pc = ev(l.args, l) ?? pc; break;
          case 'byte': case 'asciiz':
            for (const a of args) {
              const str = decodeString(a);
              if (str) str.forEach(emit);
              else { const v = ev(a, l) ?? 0; if (final && (v < -128 || v > 255)) throw new AsmError(`line ${l.line}: byte out of range ${v}`); emit(v); }
            }
            if (l.dir === 'asciiz') emit(0);
            break;
          case 'word':
            for (const a of args) { const v = ev(a, l) ?? 0; emit(v); emit(v >> 8); }
            break;
          default: throw new AsmError(`line ${l.line}: unknown directive .${l.dir}`);
        }
        continue;
      }
      // instruction
      const { mnemonic, operand } = l;
      if (mnemonic in IMPLIED) {
        if (operand.mode !== 'imp') throw new AsmError(`line ${l.line}: ${mnemonic} takes no operand`);
        emit(IMPLIED[mnemonic]);
        continue;
      }
      if (mnemonic in BRANCH) {
        const target = ev(operand.expr, l);
        const off = target === undefined ? 0 : target - (pc + 2);
        if (final && (off < -128 || off > 127)) throw new AsmError(`line ${l.line}: branch out of range (${off})`);
        emit(BRANCH[mnemonic]); emit(off);
        continue;
      }
      const table = OPCODES[mnemonic];
      if (!table) throw new AsmError(`line ${l.line}: unknown instruction ${mnemonic}`);
      let mode = operand.mode;
      const v = operand.expr !== undefined ? ev(operand.expr, l) : undefined;
      const small = v !== undefined && v >= 0 && v < 256;
      if (mode === 'imp' && table.acc !== undefined) mode = 'acc';
      else if (mode === 'addr') mode = small && table.zp !== undefined ? 'zp' : 'abs';
      else if (mode === 'x') mode = small && table.zpx !== undefined ? 'zpx' : 'absx';
      else if (mode === 'y') mode = small && table.zpy !== undefined ? 'zpy' : 'absy';
      const opc = table[mode];
      if (opc === undefined) throw new AsmError(`line ${l.line}: ${mnemonic} has no ${mode} mode`);
      emit(opc);
      const size = SIZE[mode];
      if (size >= 2) {
        const val = v ?? 0;
        if (final && size === 2 && mode !== 'imm' && (val < 0 || val > 255)) throw new AsmError(`line ${l.line}: zero-page operand out of range`);
        if (final && mode === 'imm' && (val < -128 || val > 255)) throw new AsmError(`line ${l.line}: immediate out of range ${val}`);
        emit(val);
        if (size === 3) emit(val >> 8);
      }
    }
    if (final) return { bytes, symbols: next, start: lo, end: hi };
    prev = symbols;
    symbols = next;
  }
  throw new AsmError('symbols did not settle after 10 passes');
}
