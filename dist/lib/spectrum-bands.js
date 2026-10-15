const ATTACK_SECONDS = 0.006;
const RELEASE_SECONDS = 0.18;
const NOISE_FLOOR = 10 ** (-78 / 20);
const DISPLAY_GAIN = 100;
const DISPLAY_RANGE = Math.log1p(0.15 * DISPLAY_GAIN);

export class SpectrumBands {
  constructor(count, sampleRate, fftSize) {
    this.levels = new Float32Array(count);
    const binHz = sampleRate / fftSize;
    const low = 45, high = Math.min(16000, sampleRate * 0.45);
    this.ranges = Array.from({ length: count }, (_, index) => [
      low * (high / low) ** (index / count) / binHz + 0.5,
      low * (high / low) ** ((index + 1) / count) / binHz + 0.5,
    ]);
  }

  reset() { this.levels.fill(0); }

  update(decibels, elapsedSeconds) {
    const elapsed = Math.max(0, elapsedSeconds);
    const attack = 1 - Math.exp(-elapsed / ATTACK_SECONDS);
    const release = 1 - Math.exp(-elapsed / RELEASE_SECONDS);
    for (let i = 0; i < this.levels.length; i++) {
      const [start, end] = this.ranges[i];
      let power = 0;
      for (let bin = Math.max(1, Math.floor(start)); bin < Math.min(decibels.length, Math.ceil(end)); bin++) {
        const overlap = Math.max(0, Math.min(end, bin + 1) - Math.max(start, bin));
        // Integrate linear power, including fractional bins at log-band edges.
        // Picking the loudest bin or averaging dB hides changes in total energy.
        if (Number.isFinite(decibels[bin])) power += 10 ** (decibels[bin] / 10) * overlap;
      }
      const amplitude = Math.max(0, Math.sqrt(power) - NOISE_FLOOR);
      const target = Math.min(1, Math.log1p(amplitude * DISPLAY_GAIN) / DISPLAY_RANGE);
      const response = target > this.levels[i] ? attack : release;
      this.levels[i] += (target - this.levels[i]) * response;
    }
    return this.levels;
  }
}
