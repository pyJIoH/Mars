import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { IE15_ROM } from '../src/font-rom.js';
import { ie15Code, ie15Glyph, drawIE15Screen, IE15_CELL_WIDTH, IE15_CELL_HEIGHT } from '../src/font.js';
import { Terminal } from '../src/terminal.js';

test('font bytes match the independently catalogued MAME ROM and the shipped binary', () => {
  assert.equal(IE15_ROM.length, 2048);
  assert.equal(createHash('sha1').update(IE15_ROM).digest('hex'), '6af9fb75f5375943d5c0ce9ed408e0fb4621b17e');
  assert.equal(createHash('sha256').update(IE15_ROM).digest('hex'), '8d492395490f80cf5fb400ed89f3700e59f250aecf7e27e4f24b9afe27beade0');
  assert.deepEqual(Buffer.from(IE15_ROM), readFileSync(new URL('../assets/fonts/chargen-15ie.bin', import.meta.url)));
});
test('the person, slashes and grave retain the original ROM scan lines', () => {
  const expected = {
    O: [56, 68, 130, 130, 130, 130, 68, 56],
    '/': [0, 2, 4, 8, 16, 32, 64, 128],
    V: [130, 130, 130, 68, 68, 40, 40, 16],
    M: [130, 198, 170, 146, 130, 130, 130, 130],
    '\\': [0, 128, 64, 32, 16, 8, 4, 2],
    _: [0, 0, 0, 0, 0, 0, 0, 254],
    '+': [0, 16, 16, 16, 254, 16, 16, 16],
  };
  for (const [character, rows] of Object.entries(expected)) assert.deepEqual([...ie15Glyph(character)], rows);
});
test('Latin and both Cyrillic registers address their own ROM banks', () => {
  assert.equal(ie15Code('O'), 0x4f);
  assert.equal(ie15Code('о'), 0xcf);
  assert.equal(ie15Code('О'), 0xef);
  assert.equal(ie15Code('м'), 0xcd);
  assert.equal(ie15Code('М'), 0xed);
  assert.notDeepEqual(ie15Glyph('O'), ie15Glyph('О'));
  assert.notDeepEqual(ie15Glyph('M'), ie15Glyph('М'));
  assert.equal(ie15Code('Ъ'), 0xdf); // FF is a cursor, never a Cyrillic glyph.
});
test('person is rasterized in 10×11 cells with the correct bit order and blank gutters', () => {
  assert.equal(IE15_CELL_WIDTH, 10); assert.equal(IE15_CELL_HEIGHT, 11);
  const terminal = new Terminal(3, 3);
  terminal.cells = [...' O ' + '/V\\' + '_M_'];
  const width = 30, height = 33, raster = new Uint8Array(width * height);
  const context = {
    fillStyle: '',
    fillRect(x, y, w, h) {
      assert.ok([x, y, w, h].every(Number.isInteger));
      for (let row = y; row < y + h; row++) {
        for (let column = x; column < x + w; column++) raster[row * width + column] = this.fillStyle === '#061009' ? 0 : 1;
      }
    },
    fillText() { assert.fail('ROM rendering must not call the browser text renderer'); },
  };
  drawIE15Screen(context, terminal);
  assert.equal(context.imageSmoothingEnabled, false);
  // O begins in cell 1. The slash's rightmost dot moves left on each scan line.
  assert.equal(raster[12], 1); assert.equal(raster[10], 0);
  assert.equal(raster[(11 + 1) * width + 6], 1);
  assert.equal(raster[(11 + 7) * width], 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) if (x % 10 >= 7 || y % 11 >= 8) assert.equal(raster[y * width + x], 0);
  }
});
