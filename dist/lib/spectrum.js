import { SpectrumBands } from './spectrum-bands.js?v=20261016-4';

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
      if (timestamp - this.lastDraw >= 1000 / 60 - 0.5) {
        const elapsed = Number.isFinite(this.lastDraw) ? Math.min((timestamp - this.lastDraw) / 1000, 0.1) : 1 / 60;
        this.lastDraw = timestamp;
        this.draw(this.getAnalyser(), elapsed);
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
      this.bands?.reset();
      this.draw();
    }
  }

  draw(analyser = null, elapsed = 1 / 60) {
    if (!this.context || !this.width || !this.height) return;
    if (analyser) {
      if (this.bins?.length !== analyser.frequencyBinCount) this.bins = new Float32Array(analyser.frequencyBinCount);
      analyser.getFloatFrequencyData(this.bins);
    }
    const ctx = this.context;
    const count = Math.min(72, Math.max(16, Math.floor(this.width / 8)));
    const spacing = this.width / count;
    const baseline = this.height - 3;
    let levels;
    if (analyser) {
      if (this.bands?.levels.length !== count || this.bandSampleRate !== analyser.context.sampleRate || this.bandFftSize !== analyser.fftSize) {
        this.bands = new SpectrumBands(count, analyser.context.sampleRate, analyser.fftSize);
        this.bandSampleRate = analyser.context.sampleRate;
        this.bandFftSize = analyser.fftSize;
      }
      levels = this.bands.update(this.bins, elapsed);
    }
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < count; i++) {
      const barHeight = Math.max(1, (levels?.[i] || 0) * (this.height - 8));
      const x = (i + 0.5) * spacing;
      ctx.moveTo(x, baseline);
      ctx.lineTo(x, baseline - barHeight);
    }
    ctx.stroke();
  }
}
