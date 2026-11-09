// VT52 cursor control and KOI-7 N0/N1 character sets used by MARS.SAV.
const CYRILLIC = 'юабцдефгхийклмнопярстужвьызшэщчъ';
export function koi7(byte, russian = true) {
  if (russian && byte >= 0x60 && byte <= 0x7e) return CYRILLIC[byte - 0x60];
  if (russian && byte >= 0x40 && byte <= 0x5e) return CYRILLIC[byte - 0x40].toUpperCase();
  return String.fromCharCode(byte);
}

export class Terminal {
  constructor(columns = 80, rows = 24) {
    this.columns = columns; this.rows = rows;
    this.cells = Array(columns * rows).fill(' ');
    this.x = this.y = 0; this.russian = false; this.escape = '';
    this.revision = 0; this.bells = 0;
  }
  clear() { this.cells.fill(' '); this.x = this.y = 0; this.revision++; }
  scroll() { this.cells.copyWithin(0, this.columns); this.cells.fill(' ', (this.rows - 1) * this.columns); this.y = this.rows - 1; }
  write(byte) {
    byte &= 127;
    this.revision++;
    if (this.escape === 'row') { this.targetRow = byte - 32; this.escape = 'column'; return; }
    if (this.escape === 'column') { this.y = Math.max(0, Math.min(this.rows - 1, this.targetRow)); this.x = Math.max(0, Math.min(this.columns - 1, byte - 32)); this.escape = ''; return; }
    if (this.escape === 'esc') {
      this.escape = '';
      switch (String.fromCharCode(byte)) {
        case 'Y': this.escape = 'row'; break;
        case 'H': this.x = this.y = 0; break;
        case 'J': this.cells.fill(' ', this.y * this.columns + this.x); break;
        case 'K': this.cells.fill(' ', this.y * this.columns + this.x, (this.y + 1) * this.columns); break;
        case 'A': this.y = Math.max(0, this.y - 1); break;
        case 'B': this.y = Math.min(this.rows - 1, this.y + 1); break;
        case 'C': this.x = Math.min(this.columns - 1, this.x + 1); break;
        case 'D': this.x = Math.max(0, this.x - 1); break;
        case 'I': if (this.y) this.y--; else { this.cells.copyWithin(this.columns, 0, (this.rows - 1) * this.columns); this.cells.fill(' ', 0, this.columns); } break;
        default: break;
      }
      return;
    }
    switch (byte) {
      case 0: return;
      case 7: this.bells++; return;
      case 8: this.x = Math.max(0, this.x - 1); return;
      case 9: this.x = Math.min(this.columns - 1, (Math.floor(this.x / 8) + 1) * 8); return;
      case 10: this.y++; if (this.y >= this.rows) this.scroll(); return;
      case 12: this.clear(); return;
      case 13: this.x = 0; return;
      case 14: this.russian = true; return;
      case 15: this.russian = false; return;
      case 23: return; // DVK cursor off.
      case 27: this.escape = 'esc'; return;
    }
    if (byte < 32 || byte === 127) return;
    // VT52 terminals don't wrap until another printable byte arrives.
    if (this.x >= this.columns) { this.x = 0; if (++this.y >= this.rows) this.scroll(); }
    this.cells[this.y * this.columns + this.x] = koi7(byte, this.russian);
    this.x++;
  }
  text() { return Array.from({ length: this.rows }, (_, y) => this.cells.slice(y * this.columns, (y + 1) * this.columns).join('')).join('\n'); }
}
