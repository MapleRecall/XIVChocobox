// All intervals are [start, end); the finite limit includes the first traversal.
export class LoopCursor {
  constructor(length = 0, loop = null, limit = 3) {
    this.length = length;
    this.loop = loop && loop.start >= 0 && loop.end > loop.start && loop.end <= length ? loop : null;
    this.setLimit(limit); this.reset();
  }
  reset() { this.position = 0; this.pass = 1; this.playing = false; this.finished = false; this.loopExited = false; }
  seek(position) {
    if (!Number.isFinite(position)) return;
    this.position = Math.max(0, Math.min(this.length, Math.round(position)));
    this.finished = this.position === this.length;
    if (this.finished) this.playing = false;
    this.loopExited = Boolean(this.loop && this.position >= this.loop.end);
  }
  setLimit(limit) {
    if (limit !== Infinity && (!Number.isInteger(limit) || limit < 1 || limit > 999)) throw new Error('循环次数必须是 1～999 的整数。');
    this.limit = limit;
  }
  play() { if (this.finished) this.reset(); if (this.length) this.playing = true; }
  pause() { this.playing = false; }
  advance() {
    if (!this.playing) return;
    this.position++;
    if (this.loop && !this.loopExited && this.position >= this.loop.end) {
      if (this.pass < this.limit) { this.position = this.loop.start; this.pass++; }
      else this.loopExited = true;
    }
    if (this.position >= this.length) { this.position = this.length; this.playing = false; this.finished = true; }
  }
  state() { return { position: this.position, pass: this.pass, playing: this.playing, finished: this.finished, loopExited: this.loopExited }; }
}
