import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { MarsMachine, GAME_LOOP } from '../src/machine.js';
import { PDP11 } from '../src/pdp11.js';
import { Terminal } from '../src/terminal.js';

const image = readFileSync(new URL('../MARS.SAV', import.meta.url));
const data = readFileSync(new URL('../MARS.DAT', import.meta.url));
function boot(level = 0, saved = data) {
  const m = new MarsMachine(image, saved);
  m.line('WEB'); m.line('Y'); m.tick(); m.send(48 + level); m.tick();
  assert.equal(m.inGame, true);
  assert.equal(m.cpu.r[7], GAME_LOOP);
  return m;
}
function call(m, address) {
  const pc = m.cpu.r[7], sp = m.cpu.r[6], sentinel = 0xfffe;
  m.cpu.push(sentinel); m.cpu.r[7] = address;
  let count = 0;
  while (m.cpu.r[7] !== sentinel && count++ < 20000) m.cpu.step();
  assert.ok(count < 20000, 'Original subroutine returned');
  assert.equal(m.cpu.r[6], sp);
  m.cpu.r[7] = pc;
}
function grave(m, person = 0) {
  const column = 6 + person * 5;
  m.cpu.memory[0o10236 + column] = 21;
  call(m, 0o11612);
  for (let frame = 0; frame < 32; frame++) call(m, 0o12632);
  assert.equal(m.cpu.memory[0o12120 + person], 255);
}
test('archival files remain byte-for-byte intact', () => {
  assert.equal(createHash('sha256').update(image).digest('hex'), '29d7168c4af8e801e68f807ec6dd3703e86d7e512c4f04ecc6add8a757c5b193');
  assert.equal(createHash('sha256').update(data).digest('hex'), '5c162d1b0773f9b8dcf4891b4936572f20d1edddde87d1cc94f0535e5e8c7a72');
});
test('original program logs in and draws its own 14 people and platform', () => {
  const m = boot();
  m.tick();
  assert.equal(m.stats().people, 14);
  assert.equal((m.terminal.text().match(/\/V\\/g) || []).length, 14);
  assert.match(m.terminal.text(), /==!==/);
  assert.match(m.terminal.text(), /количество марсиан =\s+45/);
});
test('all six original classes play to results and write a reloadable DAT', () => {
  for (let level = 0; level < 6; level++) {
    const m = boot(level); let saved;
    m.onSave = bytes => { saved = bytes.slice(); };
    let maxKills = 0, maxLost = 0, maxGraves = 0;
    for (let frame = 0; !m.roundComplete && frame < 16000; frame++) {
      if (frame % 4 === 0) m.send(32);
      if (frame % 300 === 0) m.send(frame % 600 ? 52 : 54);
      m.tick();
      maxKills = Math.max(maxKills, m.stats().destroyed);
      maxLost = Math.max(maxLost, m.stats().peopleLost);
      maxGraves = Math.max(maxGraves, m.stats().gravesDestroyed);
    }
    assert.equal(m.roundComplete, true, 'Class ' + level + ' finished');
    assert.ok(maxKills > 0); assert.ok(maxLost > 0); assert.ok(maxGraves > 0);
    assert.match(m.terminal.text(), /общий счет/);
    assert.equal(saved?.length, 1024);
    const resumed = boot(level, saved);
    assert.equal(resumed.waitingLine, null);
    assert.equal(resumed.stats().difficulty, level);
  }
});
test('the actual death routine produces a grave, and a second bomb erases it', () => {
  const m = boot(); grave(m);
  assert.equal(m.stats().people, 13);
  assert.equal(m.stats().peopleLost, 1);
  assert.match(m.terminal.text(), /\+/);
  m.cpu.memory[0o10236 + 6] = 22;
  call(m, 0o11760);
  assert.equal(m.cpu.memory[0o12120], 0);
  assert.equal(m.stats().gravesDestroyed, 1);
  assert.doesNotMatch(m.terminal.text(), /\+/);
});
test('VT52 cursor addressing and KOI-7 Russian text', () => {
  const t = new Terminal();
  for (const b of [14, ...Buffer.from('mars'), 15, 27, 89, 35, 39, 43]) t.write(b);
  assert.equal(t.cells.slice(0, 4).join(''), 'марс');
  assert.equal(t.cells[3 * 80 + 7], '+');
  for (const b of [27, 72, 27, 74]) t.write(b);
  assert.equal(t.text().trim(), '');
});
test('PDP-11 CMP uses source minus destination; byte moves sign-extend', () => {
  const c = new PDP11(new Uint8Array(512));
  c.r[7] = 512; c.r[0] = 3;
  c.putWord(512, 0o022700); c.putWord(514, 5);
  c.step(); assert.equal(c.n, false); assert.equal(c.c, false); assert.equal(c.z, false);
  c.putWord(516, 0o112700); c.putWord(518, 255);
  c.step(); assert.equal(c.r[0], 65535); assert.equal(c.n, true);
});
