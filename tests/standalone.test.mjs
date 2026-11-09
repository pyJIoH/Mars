// Run the built, single-file app with a minimal DOM test harness.
// This is a source-level integration test, not a replacement for visual browser QA.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import '../tools/build.mjs';

test('single-file edition works offline without WebGL and supports start, pause, resume, restart', async () => {
  const html = readFileSync(new URL('../МАРС.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href="(?:styles|favicon)/);
  const archive = html.match(/id="mars-archive">([\s\S]*?)<\/script>/)[1];
  const source = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
  assert.doesNotMatch(source, /^import /m);
  assert.equal(createHash('sha256').update(Buffer.from(JSON.parse(archive).sav, 'base64')).digest('hex'), '29d7168c4af8e801e68f807ec6dd3703e86d7e512c4f04ecc6add8a757c5b193');

  class Element {
    constructor(id) { this.id = id; this.listeners = {}; this.hidden = false; this.disabled = true; this.textContent = ''; this.firstChild = { textContent: '' }; this.checked = false; this.value = '0'; this.dataset = {}; this.attributes = {}; }
    addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
    setAttribute(name, value) { this.attributes[name] = value; }
    focus() {}
    matches() { return false; }
    click() { for (const fn of this.listeners.click ?? []) fn({ target: this }); }
    setPointerCapture() {}
  }
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); };
  const keys = {}, windowEvents = {}, storage = new Map();
  const touch = ['left', 'stop', 'right', 'fire'].map(name => { const e = new Element(name); e.dataset.control = name; return e; });
  let paintCalls = 0, screenCopies = 0, lastRaster, raf;
  const rasterContext = { fillRect() { paintCalls++; }, fillText() { throw new Error('System fonts must never draw ROM glyphs'); } };
  get('terminal').getContext = type => type === 'webgl2' ? null : {
    fillRect() { paintCalls++; },
    drawImage(source) { screenCopies++; lastRaster = source; },
  };
  get('terminal').width = 800; get('terminal').height = 264;
  get('mars-archive').textContent = archive;
  globalThis.document = {
    getElementById: get,
    createElement: () => ({ getContext: () => rasterContext }),
    querySelector: () => null,
    querySelectorAll: selector => selector === '[data-control]' ? touch : [],
    addEventListener: (name, fn) => { keys[name] = fn; },
  };
  globalThis.window = { addEventListener: (name, fn) => { windowEvents[name] = fn; } };
  globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
  globalThis.requestAnimationFrame = callback => { raf = callback; };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('Offline edition attempted a network request'); };
  try {
    await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
    assert.equal(get('start').disabled, false);
    assert.equal(get('status').textContent, 'ОЖИДАНИЕ');
    get('start').click();
    assert.equal(get('start-panel').hidden, true);
    assert.equal(get('status').textContent, 'НА СВЯЗИ');
    assert.ok(paintCalls > 100, 'Original sprites were drawn');
    const startedPaint = paintCalls;
    let now = performance.now();
    for (let frame = 0; frame < 15; frame++) raf(now += 20);
    assert.ok(paintCalls > startedPaint, 'Original screen updates while the game runs');
    assert.ok(screenCopies > 0, 'The fallback copies the original raster to the visible screen');
    assert.equal(lastRaster.width, 800);
    assert.equal(lastRaster.height, 264);
    get('pause').click();
    assert.equal(get('pause-panel').hidden, false);
    const pausedPaint = paintCalls;
    raf(now += 200);
    assert.equal(paintCalls, pausedPaint);
    const copiesBeforeResize = screenCopies;
    get('terminal').clientWidth = 400; get('terminal').clientHeight = 300;
    windowEvents.resize(); raf(now += 20);
    assert.equal(get('terminal').width, 400);
    assert.equal(get('terminal').height, 300);
    assert.ok(screenCopies > copiesBeforeResize, 'Resizing repaints even while the game is paused');
    get('resume').click();
    assert.equal(get('status').textContent, 'НА СВЯЗИ');
    windowEvents.blur();
    assert.equal(get('pause-panel').hidden, false, 'Losing focus pauses the game');
    get('restart').click();
    assert.equal(get('start-panel').hidden, false);
    get('start').click();
    assert.equal(get('status').textContent, 'НА СВЯЗИ');
    assert.equal(get('start-panel').hidden, true);
  } finally {
    globalThis.fetch = originalFetch;
    delete globalThis.document; delete globalThis.window;
    delete globalThis.localStorage; delete globalThis.requestAnimationFrame;
  }
});
