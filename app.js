import { MarsMachine } from './src/machine.js';
import { drawIE15Screen, drawIE15Illustrations } from './src/font.js';

const $ = id => document.getElementById(id);
const canvas = $('terminal'), ctx = canvas.getContext('2d');
const held = new Set();
let image, originalData, machine, playing = false, paused = false, sound = false;
let audioContext, previousTime = 0, accumulator = 0, lastRevision = -1;
let direction = 0, lastFire = -10;
const FRAME_MS = 20;
const DISK_KEY = 'mars-return.disk.v1.original';
const SOUND_KEY = 'mars-return.sound.v1';

function message(text) { $('message').textContent = text; }
function disk() {
  try {
    const saved = localStorage.getItem(DISK_KEY);
    if (saved) {
      const bytes = Uint8Array.from(atob(saved), c => c.charCodeAt(0));
      if (bytes.length === 1024) return bytes;
    }
  } catch { /* Private browsing can disable storage. */ }
  return originalData.slice();
}
function saveDisk(bytes) {
  try { localStorage.setItem(DISK_KEY, btoa(String.fromCharCode(...bytes))); }
  catch { message('Рекорды доступны до закрытия вкладки: браузер запретил постоянное хранение.'); }
}
function bell() {
  if (!sound || !audioContext) return;
  const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
  oscillator.type = 'square'; oscillator.frequency.value = 880;
  gain.gain.setValueAtTime(.025, audioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .07);
  oscillator.connect(gain); gain.connect(audioContext.destination);
  oscillator.start(); oscillator.stop(audioContext.currentTime + .08);
}
function draw(force = false) {
  const terminal = machine?.terminal;
  if (!force && terminal?.revision === lastRevision) return;
  lastRevision = terminal?.revision ?? -1;
  ctx.fillStyle = '#061009'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!terminal) return;
  drawIE15Screen(ctx, terminal);
}
function readout() {
  if (!machine?.inGame) return;
  const stats = machine.stats();
  $('people').firstChild.textContent = String(stats.people).padStart(2, '0');
  $('enemies').textContent = String(stats.remaining).padStart(2, '0');
  $('kills').textContent = String(stats.destroyed).padStart(2, '0');
}
function clearControls() {
  held.clear();
  if (direction && machine?.inGame) machine.send(53);
  direction = 0;
}
function setPaused(value) {
  if (!playing) return;
  paused = value; accumulator = 0; clearControls();
  $('pause-panel').hidden = !paused;
  $('pause').textContent = paused ? 'Продолжить' : 'Пауза';
  $('status').textContent = paused ? 'ПАУЗА' : 'НА СВЯЗИ';
  if (!paused) canvas.focus({ preventScroll: true });
}
function showStart() {
  clearControls(); playing = paused = false;
  $('start-panel').hidden = false; $('pause-panel').hidden = true;
  $('pause').disabled = true; $('pause').textContent = 'Пауза';
  $('restart').disabled = true; $('status').textContent = 'ОЖИДАНИЕ';
  $('start').focus({ preventScroll: true });
  message('');
}
function begin() {
  if (!image) return;
  try {
    machine = new MarsMachine(image, disk(), { onSave: saveDisk, onBell: bell });
    // Use the original login and class selection, rather than patching game RAM.
    machine.line('WEB'); machine.line('Y');
    for (let i = 0, n = 1 + Date.now() % 71; i < n; i++) machine.tick();
    machine.send(48 + Number($('level').value)); machine.tick();
    if (!machine.inGame) throw new Error('Оригинальная программа не перешла к игре.');
    held.clear(); direction = 0; lastFire = -10;
    playing = true; paused = false; accumulator = 0; previousTime = performance.now();
    $('start-panel').hidden = true; $('pause-panel').hidden = true;
    $('pause').disabled = false; $('pause').textContent = 'Пауза';
    $('restart').disabled = false; $('status').textContent = 'НА СВЯЗИ';
    message('Стрелки — движение и остановка. 4 / 5 / 6 — управление с инерцией; 1 / 2 / 3 — скорость.');
    canvas.focus({ preventScroll: true }); draw(true); readout();
  } catch (error) { fail(error); }
}
function fail(error) {
  playing = false; paused = false; clearControls();
  $('pause').disabled = true; $('status').textContent = 'ОШИБКА';
  message('Не удалось запустить игру: ' + error.message);
  $('start-panel').hidden = false; $('pause-panel').hidden = true;
  $('start').disabled = !image; $('start').textContent = image ? 'ПОВТОРИТЬ ↵' : 'НЕТ ДАННЫХ';
  console.error(error);
}
function updateInput() {
  const next = held.has('right') ? 1 : held.has('left') ? -1 : 0;
  if (next !== direction) { machine.send(next === 1 ? 54 : next === -1 ? 52 : 53); direction = next; }
  if (held.has('fire') && machine.frames - lastFire >= 4) {
    machine.send(32); lastFire = machine.frames;
  }
}
function frame(time) {
  const elapsed = Math.min(time - previousTime, 120); previousTime = time;
  if (playing && !paused) {
    accumulator += elapsed;
    try {
      for (let i = 0; accumulator >= FRAME_MS && i < 6 && playing; i++) {
        accumulator -= FRAME_MS; updateInput(); machine.tick();
        if (machine.roundComplete || machine.exited) {
          playing = false; clearControls(); $('pause').disabled = true;
          $('status').textContent = 'ПАРТИЯ ЗАВЕРШЕНА';
          message('Результаты — на оригинальном экране. Нажмите Enter или «Новая игра», чтобы сыграть ещё.');
        }
      }
      draw(); readout();
    } catch (error) { fail(error); }
  }
  requestAnimationFrame(frame);
}

$('start').addEventListener('click', begin);
$('restart').addEventListener('click', showStart);
$('pause').addEventListener('click', () => setPaused(!paused));
$('resume').addEventListener('click', () => setPaused(false));
$('sound').addEventListener('click', async () => {
  sound = !sound;
  if (sound) {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) { sound = false; message('Звук в этом браузере недоступен.'); return; }
    audioContext ??= new Audio();
    await audioContext.resume(); bell();
  }
  $('sound').setAttribute('aria-pressed', String(sound));
  $('sound').setAttribute('aria-label', sound ? 'Выключить звук' : 'Включить звук');
  try { localStorage.setItem(SOUND_KEY, String(sound)); } catch { /* Optional preference. */ }
});
$('fullscreen').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if ($('monitor').requestFullscreen) await $('monitor').requestFullscreen();
    else { message('Полноэкранный режим недоступен в этом браузере.'); return; }
    if (playing) canvas.focus({ preventScroll: true });
  } catch { message('Браузер не разрешил полноэкранный режим.'); }
});

const keyControl = event => {
  if (event.code === 'ArrowLeft' || event.code === 'KeyA') return 'left';
  if (event.code === 'ArrowRight' || event.code === 'KeyD') return 'right';
  if (event.code === 'Space') return 'fire';
};
document.addEventListener('keydown', event => {
  if (event.target.matches('select, input, textarea, summary, a') || event.ctrlKey || event.metaKey || event.altKey) return;
  if (!playing) {
    if (event.code === 'Enter' && image && !event.target.matches('button')) { event.preventDefault(); begin(); }
    return;
  }
  if (['KeyP', 'Escape'].includes(event.code) || (paused && event.code === 'Enter')) {
    event.preventDefault(); if (!event.repeat) setPaused(!paused); return;
  }
  const control = keyControl(event);
  if (control) { event.preventDefault(); if (!paused) held.add(control); }
  if (!paused && !event.repeat && /^Digit[1-6]$/.test(event.code)) {
    event.preventDefault(); machine.send(event.code.charCodeAt(5)); direction = 0;
  }
});
document.addEventListener('keyup', event => {
  const control = keyControl(event); if (control) held.delete(control);
});
for (const button of document.querySelectorAll('[data-control]')) {
  button.addEventListener('pointerdown', event => {
    event.preventDefault();
    if (!playing || paused) return;
    button.setPointerCapture(event.pointerId);
    if (button.dataset.control === 'stop') { held.delete('left'); held.delete('right'); machine.send(53); direction = 0; }
    else held.add(button.dataset.control);
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    button.addEventListener(type, () => held.delete(button.dataset.control));
  }
}
window.addEventListener('blur', () => { if (playing && !paused) setPaused(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && playing && !paused) setPaused(true); });

drawIE15Illustrations();
try {
  const embedded = $('mars-archive');
  if (embedded) {
    const archive = JSON.parse(embedded.textContent);
    image = Uint8Array.from(atob(archive.sav), c => c.charCodeAt(0));
    originalData = Uint8Array.from(atob(archive.dat), c => c.charCodeAt(0));
    for (const [name, bytes] of [['MARS.SAV', image], ['MARS.DAT', originalData]]) {
      const link = document.querySelector('a[download][href="' + name + '"]');
      if (link) { link.href = URL.createObjectURL(new Blob([bytes])); link.download = name; }
    }
  } else {
    const responses = await Promise.all(['MARS.SAV', 'MARS.DAT'].map(file => fetch(new URL(file, import.meta.url))));
    for (const response of responses) if (!response.ok) throw new Error('Файл ' + response.url.split('/').pop() + ' недоступен (' + response.status + ')');
    const buffers = await Promise.all(responses.map(r => r.arrayBuffer()));
    image = new Uint8Array(buffers[0]); originalData = new Uint8Array(buffers[1]);
  }
  if (image.length !== 7680 || originalData.length !== 1024) throw new Error('Повреждены оригинальные файлы.');
  $('start').disabled = false; $('start').textContent = 'НАЧАТЬ ИГРУ ↵'; $('status').textContent = 'ОЖИДАНИЕ';
  draw(true);
} catch (error) { fail(error); }
requestAnimationFrame(frame);
