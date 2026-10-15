export class AudioSpectrum {
  constructor(canvas, getAnalyser) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    this.getAnalyser = getAnalyser;
    this.playing = false;
    this.frame = null;
    this.lastDraw = -Infinity;
    this.reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    this.tick = timestamp => {
      this.frame = null;
      if (timestamp - this.lastDraw >= 1000 / 30) {
        this.lastDraw = timestamp;
        this.draw(this.getAnalyser());
      }
      this.frame = requestAnimationFrame(this.tick);
    };
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    document.addEventListener('visibilitychange', () => this.sync());
    this.reducedMotion.addEventListener('change', () => this.sync());
    this.resize();
  }

  resize() {
    if (!this.context) return;
    this.width = this.canvas.clientWidth;
    this.height = this.canvas.clientHeight;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * scale);
    this.canvas.height = Math.round(this.height * scale);
    this.context.setTransform(scale, 0, 0, scale, 0, 0);
    this.color = getComputedStyle(this.canvas).color;
    this.draw(this.playing && !document.hidden && !this.reducedMotion.matches ? this.getAnalyser() : null);
  }

  setPlaying(playing) {
    if (this.playing === playing) return;
    this.playing = playing;
    this.color = getComputedStyle(this.canvas).color;
    this.sync();
  }

  sync() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    const active = this.playing && !document.hidden && !this.reducedMotion.matches;
    this.canvas.classList.toggle('is-playing', active);
    if (active && this.context) {
      this.lastDraw = -Infinity;
      this.frame = requestAnimationFrame(this.tick);
    } else {
      this.draw();
    }
  }

  draw(analyser = null) {
    if (!this.context || !this.width || !this.height) return;
    if (analyser) {
      if (this.bins?.length !== analyser.frequencyBinCount) this.bins = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(this.bins);
    }
    const ctx = this.context;
    const count = Math.min(72, Math.max(16, Math.floor(this.width / 8)));
    const spacing = this.width / count;
    const baseline = this.height - 3;
    const binHz = analyser ? analyser.context.sampleRate / analyser.fftSize : 1;
    const low = 55, high = analyser ? Math.min(16000, analyser.context.sampleRate * 0.45) : 16000;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      let level = 0;
      if (analyser) {
        const start = Math.max(1, Math.floor(low * (high / low) ** (i / count) / binHz));
        const end = Math.min(this.bins.length, Math.max(start + 1, Math.ceil(low * (high / low) ** ((i + 1) / count) / binHz)));
        for (let bin = start; bin < end; bin++) level = Math.max(level, this.bins[bin] / 255);
      }
      const barHeight = Math.max(1, level ** 1.8 * (this.height - 8));
      const x = (i + 0.5) * spacing;
      ctx.moveTo(x, baseline);
      ctx.lineTo(x, baseline - barHeight);
    }
    ctx.stroke();
  }
}
