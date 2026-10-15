import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpectrumBands } from '../dist/lib/spectrum-bands.js';

function tone(decibels, hz = 1000, sampleRate = 48000) {
  const bins = new Float32Array(1024).fill(-Infinity);
  bins[Math.round(hz / (sampleRate / 2048))] = decibels;
  return bins;
}
const peak = values => Math.max(...values);

test('a 20 dB level change produces a clear height difference without normalizing quiet audio upward', () => {
  const loud = new SpectrumBands(72, 48000, 2048);
  const quiet = new SpectrumBands(72, 48000, 2048);
  const loudPeak = peak(loud.update(tone(-24), 1));
  const quietPeak = peak(quiet.update(tone(-44), 1));
  assert.ok(loudPeak > quietPeak * 3, `${loudPeak} vs ${quietPeak}`);
  assert.ok(loudPeak < 1, 'normal peaks should retain headroom');
});

test('a drum transient rises within one frame and decays before the next beat', () => {
  const bands = new SpectrumBands(72, 48000, 2048);
  const pulse = tone(-24, 90);
  const onset = peak(bands.update(pulse, 1 / 60));
  const settled = peak(new SpectrumBands(72, 48000, 2048).update(pulse, 1));
  assert.ok(onset > settled * 0.9);
  const afterBeat = peak(bands.update(tone(-Infinity, 90), 0.2));
  assert.ok(afterBeat < onset * 0.1);
});

test('envelopes behave consistently across frame rates and silence resets to zero', () => {
  const fast = new SpectrumBands(72, 44100, 2048);
  const slow = new SpectrumBands(72, 44100, 2048);
  const signal = tone(-30, 4000, 44100), silence = signal.map(() => -Infinity);
  fast.update(signal, 1); slow.update(signal, 1);
  for (let i = 0; i < 6; i++) fast.update(silence, 1 / 60);
  for (let i = 0; i < 3; i++) slow.update(silence, 1 / 30);
  assert.ok(Math.abs(peak(fast.levels) - peak(slow.levels)) < 1e-6);
  fast.reset();
  assert.equal(peak(fast.update(silence, 1 / 60)), 0);
});
