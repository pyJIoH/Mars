// PDP-11 integer interpreter. All machine addresses and registers are 16 bit.
// Deliberately independent of DOM, clock, and the MARS program.
export class PDP11 {
  constructor(image, emt = () => {}) {
    this.memory = new Uint8Array(65536);
    this.memory.set(image);
    this.r = new Uint16Array(8);
    this.r[6] = this.word(0o42);
    this.r[7] = this.word(0o40);
    this.n = this.z = this.v = this.c = false;
    this.emt = emt;
    this.halted = false;
    this.instructions = 0;
  }
  word(a) { a &= 65535; return this.memory[a] | (this.memory[(a + 1) & 65535] << 8); }
  putWord(a, value) { a &= 65535; this.memory[a] = value; this.memory[(a + 1) & 65535] = value >> 8; }
  fetch() { const a = this.r[7]; this.r[7] += 2; return this.word(a); }
  push(value) { this.r[6] -= 2; this.putWord(this.r[6], value); }
  pop() { const value = this.word(this.r[6]); this.r[6] += 2; return value; }
  operand(spec, byte = false) {
    const reg = spec & 7, mode = spec >> 3;
    if (!mode) return { reg };
    const step = byte && reg < 6 ? 1 : 2;
    let address;
    switch (mode) {
      case 1: address = this.r[reg]; break;
      case 2: address = this.r[reg]; this.r[reg] += step; break;
      case 3: address = this.word(this.r[reg]); this.r[reg] += 2; break;
      case 4: this.r[reg] -= step; address = this.r[reg]; break;
      case 5: this.r[reg] -= 2; address = this.word(this.r[reg]); break;
      case 6: { const offset = this.fetch(); address = this.r[reg] + offset; break; }
      case 7: { const offset = this.fetch(); address = this.word(this.r[reg] + offset); break; }
    }
    return { address: address & 65535 };
  }
  read(o, byte = false) {
    return o.reg !== undefined ? this.r[o.reg] & (byte ? 255 : 65535)
      : byte ? this.memory[o.address] : this.word(o.address);
  }
  write(o, value, byte = false, extend = false) {
    if (o.reg !== undefined) {
      if (!byte) this.r[o.reg] = value;
      else if (extend) this.r[o.reg] = (value & 128) ? value | 0xff00 : value & 255;
      else this.r[o.reg] = (this.r[o.reg] & 0xff00) | (value & 255);
    } else if (byte) this.memory[o.address] = value;
    else this.putWord(o.address, value);
  }
  nz(value, byte = false) {
    const mask = byte ? 255 : 65535;
    value &= mask;
    this.n = !!(value & (byte ? 128 : 32768)); this.z = value === 0;
    return value;
  }
  step() {
    if (this.halted) return;
    const pc = this.r[7], w = this.fetch();
    this.instructions++;
    const top = w >>> 12;
    if ((top >= 1 && top <= 6) || (top >= 9 && top <= 14)) {
      const byte = top >= 9 && top <= 13;
      const sign = byte ? 128 : 32768, mask = byte ? 255 : 65535;
      // Source must be read before evaluating a destination that changes a register.
      const s = this.read(this.operand((w >> 6) & 63, byte), byte);
      const dst = this.operand(w & 63, byte), d = this.read(dst, byte);
      const op = top & 7;
      let result;
      if (op === 1) { result = this.nz(s, byte); this.v = false; this.write(dst, result, byte, byte); return; }
      if (op === 2 || top === 14) {
        const a = top === 14 ? d : s, b = top === 14 ? s : d;
        result = this.nz(a - b, byte);
        this.v = !!((a ^ b) & (a ^ result) & sign); this.c = a < b;
        if (top === 14) this.write(dst, result);
        return;
      }
      if (op === 3) { this.nz(s & d, byte); this.v = false; return; }
      if (op === 4) result = d & ~s;
      if (op === 5) result = d | s;
      if (top === 6) { result = (s + d) & mask; this.v = !!(~(s ^ d) & (d ^ result) & sign); this.c = s + d > mask; }
      else this.v = false;
      this.write(dst, this.nz(result, byte), byte); return;
    }
    const branch = w & 0o177400;
    let take;
    switch (branch) {
      case 0o000400: take = true; break;
      case 0o001000: take = !this.z; break;
      case 0o001400: take = this.z; break;
      case 0o002000: take = this.n === this.v; break;
      case 0o002400: take = this.n !== this.v; break;
      case 0o003000: take = !this.z && this.n === this.v; break;
      case 0o003400: take = this.z || this.n !== this.v; break;
      case 0o100000: take = !this.n; break;
      case 0o100400: take = this.n; break;
      case 0o101000: take = !this.c && !this.z; break;
      case 0o101400: take = this.c || this.z; break;
      case 0o102000: take = !this.v; break;
      case 0o102400: take = this.v; break;
      case 0o103000: take = !this.c; break;
      case 0o103400: take = this.c; break;
    }
    if (take !== undefined) { if (take) this.r[7] += ((w << 24) >> 24) * 2; return; }
    if ((w & 0o177400) === 0o104000) { this.emt(w & 255, this); return; }
    if ((w & 0o177770) === 0o000200) { const reg = w & 7; this.r[7] = this.r[reg]; this.r[reg] = this.pop(); return; }
    if ((w & 0o177740) === 0o000240) {
      const set = !!(w & 16);
      if (w & 8) this.n = set; if (w & 4) this.z = set; if (w & 2) this.v = set; if (w & 1) this.c = set;
      return;
    }
    if ((w & 0o177700) === 0o000100) {
      const o = this.operand(w & 63); this.r[7] = o.address ?? this.r[o.reg]; return;
    }
    if ((w & 0o177000) === 0o004000) {
      const o = this.operand(w & 63), address = o.address ?? this.r[o.reg], reg = (w >> 6) & 7;
      this.push(this.r[reg]); this.r[reg] = this.r[7]; this.r[7] = address; return;
    }
    if ((w & 0o177000) === 0o077000) { const reg = (w >> 6) & 7; if (--this.r[reg]) this.r[7] -= (w & 63) * 2; return; }
    if ((w & 0o177000) === 0o074000) {
      const o = this.operand(w & 63); this.write(o, this.nz(this.read(o) ^ this.r[(w >> 6) & 7])); this.v = false; return;
    }
    const single = w & 0o077700, byte = !!(w & 0o100000);
    if (single === 0o000300 || (single >= 0o005000 && single <= 0o006300) || single === 0o006700) {
      const o = this.operand(w & 63, byte), d = this.read(o, byte);
      const sign = byte ? 128 : 32768, mask = byte ? 255 : 65535, oldC = this.c ? 1 : 0;
      let result;
      switch (single) {
        case 0o000300: result = ((d & 255) << 8) | (d >>> 8); this.nz(result & 255, true); this.v = this.c = false; this.write(o, result); return;
        case 0o005000: result = 0; this.v = this.c = false; break;
        case 0o005100: result = ~d; this.v = false; this.c = true; break;
        case 0o005200: result = d + 1; this.v = d === sign - 1; break;
        case 0o005300: result = d - 1; this.v = d === sign; break;
        case 0o005400: result = -d; this.v = d === sign; this.c = d !== 0; break;
        case 0o005500: result = d + oldC; this.v = !!oldC && d === sign - 1; this.c = !!oldC && d === mask; break;
        case 0o005600: result = d - oldC; this.v = !!oldC && d === sign; this.c = !!oldC && d === 0; break;
        case 0o005700: this.nz(d, byte); this.v = this.c = false; return;
        case 0o006000: result = (d >>> 1) | (oldC * sign); this.c = !!(d & 1); break;
        case 0o006100: result = (d << 1) | oldC; this.c = !!(d & sign); break;
        case 0o006200: result = (d >>> 1) | (d & sign); this.c = !!(d & 1); break;
        case 0o006300: result = d << 1; this.c = !!(d & sign); break;
        case 0o006700: result = this.n ? 65535 : 0; this.z = !this.n; this.v = false; this.write(o, result); return;
      }
      result = this.nz(result, byte);
      if (single >= 0o006000) this.v = this.n !== this.c;
      this.write(o, result, byte); return;
    }
    if (w === 0) { this.halted = true; return; }
    throw new Error(`Unsupported PDP-11 instruction ${w.toString(8)} at ${pc.toString(8)}`);
  }
}
