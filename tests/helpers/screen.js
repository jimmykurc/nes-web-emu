// Read the first name table as ASCII text (blargg's console ROMs draw text
// using tile numbers equal to character codes).
export function screenText(nes) {
  const rows = [];
  for (let y = 0; y < 30; y++) {
    let row = '';
    for (let x = 0; x < 32; x++) {
      const c = nes.ppu.readMem(0x2000 + y * 32 + x);
      row += c >= 32 && c < 127 ? String.fromCharCode(c) : ' ';
    }
    rows.push(row.trimEnd());
  }
  return rows.join('\n').replace(/\n{2,}/g, '\n').trim();
}
