import { IE15_ROM } from './font-rom.js';

// IE15: seven visible bits, eight scan lines, three blank pixels/scan lines.
// Geometry and bit order verified against MAME's ie15_device::draw_scanline.
export const IE15_CELL_WIDTH = 10;
export const IE15_CELL_HEIGHT = 11;
export const IE15_GLYPH_WIDTH = 7;
export const IE15_GLYPH_HEIGHT = 8;
const ROM_CYRILLIC = 'юабцдефгхийклмнопярстужвьызшэщчъ';

export function ie15Code(character) {
  const ascii = character.codePointAt(0);
  if (ascii >= 0x20 && ascii <= 0x7e) return ascii;
  const lower = ROM_CYRILLIC.indexOf(character);
  if (lower >= 0) return 0xc0 + lower;
  const upper = ROM_CYRILLIC.toUpperCase().indexOf(character);
  // Slot FF is a solid cursor. There is no uppercase Ъ in this ROM bank.
  if (upper >= 0) return upper === 31 ? 0xdf : 0xe0 + upper;
  return 0x3f; // No modern-font fallback for unsupported characters.
}

export function ie15Glyph(character) {
  const start = ie15Code(character) * 8;
  return IE15_ROM.subarray(start, start + 8);
}

export function drawIE15Glyph(context, character, x, y) {
  const rows = ie15Glyph(character);
  for (let row = 0; row < IE15_GLYPH_HEIGHT; row++) {
    for (let column = 0; column < IE15_GLYPH_WIDTH; column++) {
      if (rows[row] & (0x80 >> column)) context.fillRect(x + column, y + row, 1, 1);
    }
  }
}

export function drawIE15Screen(context, terminal) {
  context.imageSmoothingEnabled = false;
  context.fillStyle = '#061009';
  context.fillRect(0, 0, terminal.columns * IE15_CELL_WIDTH, terminal.rows * IE15_CELL_HEIGHT);
  context.fillStyle = '#9ae282';
  for (let row = 0; row < terminal.rows; row++) {
    for (let column = 0; column < terminal.columns; column++) {
      const character = terminal.cells[row * terminal.columns + column];
      if (character !== ' ') drawIE15Glyph(context, character, column * IE15_CELL_WIDTH, row * IE15_CELL_HEIGHT);
    }
  }
}

export function drawIE15Illustrations() {
  for (const element of document.querySelectorAll('[data-rom-art]')) {
    const lines = element.textContent.split('\n');
    const picture = document.createElement('canvas');
    const scale = Number(element.dataset.romScale || 1.5);
    const columns = Math.max(...lines.map(line => [...line].length));
    picture.width = columns * IE15_CELL_WIDTH;
    picture.height = lines.length * IE15_CELL_HEIGHT;
    picture.className = 'rom-art-canvas';
    picture.setAttribute('aria-hidden', 'true');
    picture.style.width = picture.width * scale + 'px';
    picture.style.height = 'auto';
    const context = picture.getContext('2d');
    context.fillStyle = '#a6dc90';
    for (const [row, line] of lines.entries()) {
      for (const [column, character] of [...line].entries()) {
        drawIE15Glyph(context, character, column * IE15_CELL_WIDTH, row * IE15_CELL_HEIGHT);
      }
    }
    element.replaceChildren(picture);
  }
}
