import { PDP11 } from './pdp11.js';
import { Terminal } from './terminal.js';

export const GAME_LOOP = 0o6060;
export class MarsMachine {
  constructor(image, data, { onSave = () => {}, onBell = () => {} } = {}) {
    this.terminal = new Terminal(); this.disk = new Uint8Array(data);
    this.onSave = onSave; this.onBell = onBell;
    this.input = []; this.lines = []; this.waitingLine = null;
    this.inGame = false; this.frames = 0; this.exited = false; this.roundComplete = false;
    this.cpu = new PDP11(image, (code, cpu) => this.emt(code, cpu));
  }
  send(...bytes) { this.input.push(...bytes); }
  line(text) { this.lines.push(text); }
  print(address) {
    const c = this.cpu;
    for (let i = 0; i < 65536; i++) {
      const b = c.memory[(address + i) & 65535];
      if (b === 0x80) return;
      if (b === 0) { this.terminal.write(13); this.terminal.write(10); return; }
      this.terminal.write(b);
    }
    throw new Error('Unterminated RT-11 .PRINT string');
  }
  completeLine(text) {
    const { buffer } = this.waitingLine;
    const bytes = [...text.toUpperCase()].slice(0, 17).map(ch => ch.charCodeAt(0) & 127);
    this.cpu.memory.set([...bytes, 0], buffer);
    for (const b of bytes) this.terminal.write(b);
    this.terminal.write(13); this.terminal.write(10);
    this.cpu.r[6] += 8; this.cpu.c = false; this.waitingLine = null;
  }
  emt(code, c) {
    switch (code) {
      case 0o340: {
        if (this.input.length) { c.r[0] = this.input.shift(); c.c = false; }
        else { c.c = true; this.idleInput = !this.inGame; }
        break;
      }
      case 0o341: this.terminal.write(c.r[0]); c.c = false; break;
      case 0o345: {
        this.print(c.word(c.r[6] + 2));
        this.waitingLine = { buffer: c.word(c.r[6] + 6) };
        if (this.lines.length) this.completeLine(this.lines.shift());
        break;
      }
      case 0o350: this.exited = true; this.inGame = false; c.halted = true; break;
      case 0o351: this.print(c.r[0]); c.c = false; break;
      case 0o374: c.c = false; break; // .CLOSE/.PURGE: the browser disk has one file.
      case 0o375: {
        const area = c.r[0], operation = c.word(area) >>> 8;
        // .LOOKUP, .ENTER, .READW, .WRITW, .SCCA.
        if (operation === 8) {
          const target = c.word(area + 4), count = c.word(area + 6) * 2;
          c.memory.set(this.disk.slice(0, count), target);
        } else if (operation === 9) {
          const source = c.word(area + 4), count = c.word(area + 6) * 2;
          this.disk = c.memory.slice(source, source + count); this.onSave(this.disk);
        } else if (![1, 2, 29].includes(operation)) {
          throw new Error(`Unsupported RT-11 request ${operation}`);
        }
        c.c = false; break;
      }
      default: throw new Error(`Unsupported EMT ${code.toString(8)}`);
    }
  }
  // One iteration of the ORIGINAL game, including its own delays and randomizer.
  // Browser pacing replaces the speed of a particular physical DVK processor.
  tick(limit = 250000) {
    if (this.roundComplete) return;
    this.idleInput = false;
    if (this.waitingLine) {
      if (!this.lines.length) return;
      this.completeLine(this.lines.shift());
    }
    const bells = this.terminal.bells;
    for (let i = 0; i < limit && !this.cpu.halted; i++) {
      const pc = this.cpu.r[7];
      if (pc === GAME_LOOP) {
        this.inGame = true;
        if (i > 0) { this.frames++; break; }
      }
      if (pc === 0o5554 && this.inGame) { this.inGame = false; this.roundComplete = true; break; }
      this.cpu.step();
      if (this.waitingLine || this.idleInput) break;
    }
    if (this.terminal.bells !== bells) this.onBell();
  }
  stats() {
    const c = this.cpu;
    return { people: c.word(0o11610), remaining: c.word(0o7156) + c.word(0o7160),
      destroyed: c.word(0o14612), bombsIntercepted: c.word(0o14620), shots: c.word(0o14626),
      gravesDestroyed: c.word(0o14656), peopleLost: c.word(0o14642),
      score: [0o14614, 0o14622, 0o14630, 0o14636, 0o14644, 0o14652, 0o14660].reduce((s, a) => s + ((c.word(a) << 16) >> 16), 0),
      platformColumn: c.word(0o2146), difficulty: c.word(0o14664) };
  }
}
