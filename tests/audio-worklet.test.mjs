import { test } from 'node:test';
import assert from 'node:assert/strict';

let Processor;
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class { constructor() { this.port = { postMessage() {} }; } };
globalThis.registerProcessor = (_name, type) => { Processor = type; };
await import('../dist/audio-worklet.js');

test('actual worklet output is gapless across render quantum boundaries', () => {
  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'load', channels: [Float32Array.from([1,2,3,4,5,6]), Float32Array.from([11,12,13,14,15,16])], loop: { start: 2, end: 5 }, limit: 3, trackId: 1 } });
  processor.port.onmessage({ data: { type: 'play' } });
  const all = [[], []];
  for (let k = 0; k < 4; k++) {
    const output = [new Float32Array(4), new Float32Array(4)];
    processor.process([], [output]);
    output.forEach((channel, i) => all[i].push(...channel));
  }
  assert.deepEqual(all[0], [1,2,3,4,5,3,4,5,3,4,5,6,0,0,0,0]);
  assert.deepEqual(all[1], [11,12,13,14,15,13,14,15,13,14,15,16,0,0,0,0]);
});
test('paused worklet outputs silence and keeps its position', () => {
  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'load', channels: [Float32Array.from([1,2,3])], loop: null, limit: 1, trackId: 1 } });
  const output = [new Float32Array(128)]; processor.process([], [output]);
  assert(output[0].every(v => v === 0)); assert.equal(processor.cursor.position, 0);
});

test('solo channel is copied to front outputs and other outputs are muted', () => {
  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'load', channels: [Float32Array.from([1,2,3]), Float32Array.from([11,12,13]), Float32Array.from([21,22,23])], loop: null, limit: 1, trackId: 1 } });
  processor.port.onmessage({ data: { type: 'channel', channel: 2 } });
  processor.port.onmessage({ data: { type: 'play' } });
  const output = [new Float32Array(3), new Float32Array(3), new Float32Array(3)]; processor.process([], [output]);
  assert.deepEqual([...output[0]], [21,22,23]); assert.deepEqual([...output[1]], [21,22,23]); assert(output[2].every(value => value === 0));
});

test('game variant channel groups preserve the two source channels as a stereo track', () => {
  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'load', channels: [Float32Array.from([2,4]), Float32Array.from([10,20]), Float32Array.from([6,8])], loop: null, limit: 1, trackId: 1 } });
  processor.port.onmessage({ data: { type: 'channel-set', channels: [0,2], mode: 'pair' } });
  processor.port.onmessage({ data: { type: 'play' } });
  const output = [new Float32Array(2), new Float32Array(2), new Float32Array(2)]; processor.process([], [output]);
  assert.deepEqual([...output[0]], [2,4]); assert.deepEqual([...output[1]], [6,8]); assert(output[2].every(value => value === 0));
});

test('variant toggle waits for the next node and limits transition audio to the following node', () => {
  const processor = new Processor();
  const channels = Array.from({ length: 6 }, (_, index) => Float32Array.from({ length: 8 }, () => [10, 20, 30, 100, 40, 200][index]));
  processor.port.onmessage({ data: { type: 'load', channels, loop: null, limit: 1, trackId: 1, variant: { groups: [[0, 2], [1, 4], [3, 5]], marks: [2, 5, 7], loop: null, initialVariant: 0 } } });
  processor.port.onmessage({ data: { type: 'play' } });
  const frame = () => { const output = [new Float32Array(1), new Float32Array(1)]; processor.process([], [output]); return [output[0][0], output[1][0]]; };
  assert.deepEqual(frame(), [10, 30]); assert.deepEqual(frame(), [10, 30]);
  processor.port.onmessage({ data: { type: 'variant-toggle' } });
  assert.deepEqual(frame(), [10, 30]); assert.deepEqual(frame(), [10, 30]); assert.deepEqual(frame(), [10, 30]);
  assert.deepEqual(frame(), [120, 240]); assert.equal(processor.activeVariant, 1); assert(processor.transition);
  assert.deepEqual(frame(), [120, 240]); assert.deepEqual(frame(), [20, 40]); assert.equal(processor.transition, null);
});

test('pause remains responsive after transition audio ends', () => {
  const processor = new Processor();
  const channels = Array.from({ length: 6 }, (_, index) => Float32Array.from({ length: 8 }, () => [10, 20, 30, 100, 40, 200][index]));
  processor.port.onmessage({ data: { type: 'load', channels, loop: null, limit: 1, trackId: 1, variant: { groups: [[0, 2], [1, 4], [3, 5]], marks: [2, 5, 7], loop: null, initialVariant: 0 } } });
  processor.port.onmessage({ data: { type: 'play' } });
  processor.port.onmessage({ data: { type: 'variant-toggle' } });
  for (let i = 0; i < 6; i++) processor.process([], [[new Float32Array(1), new Float32Array(1)]]);
  assert.equal(processor.transition, null); assert.equal(processor.cursor.playing, true);
  processor.port.onmessage({ data: { type: 'pause' } });
  assert.equal(processor.cursor.playing, false);
});

test('pause remains responsive before entering the loop interval', () => {
  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'load', channels: [Float32Array.from([1, 2, 3, 4, 5, 6])], loop: { start: 4, end: 6 }, limit: 3, trackId: 1 } });
  processor.port.onmessage({ data: { type: 'play' } });
  processor.process([], [[new Float32Array(2)]]);
  assert.equal(processor.cursor.position, 2); assert.equal(processor.cursor.playing, true);
  processor.port.onmessage({ data: { type: 'pause' } });
  processor.process([], [[new Float32Array(2)]]);
  assert.equal(processor.cursor.position, 2); assert.equal(processor.cursor.playing, false);
});

test('changing tracks disposes the processor and releases PCM', () => {
  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'load', channels: [new Float32Array(1000)], loop: null, limit: 1, trackId: 1 } });
  processor.port.onmessage({ data: { type: 'dispose' } });
  assert.equal(processor.channels.length, 0);
  assert.equal(processor.process([], [[new Float32Array(128)]]), false);
});

test('finite final loop pass fades its configured final segment without fading the tail', () => {
  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'load', channels: [Float32Array.from([1, 2, 3, 4, 5, 6])], loop: { start: 1, end: 5 }, limit: 1, fadeOutSeconds: 3 / sampleRate, trackId: 1 } });
  processor.port.onmessage({ data: { type: 'play' } });
  const output = [new Float32Array(6)]; processor.process([], [output]);
  assert(Math.abs(output[0][0] - 1) < 1e-6);
  assert(Math.abs(output[0][1] - 2) < 1e-6);
  assert(Math.abs(output[0][2] - 3) < 1e-6);
  assert(Math.abs(output[0][3] - 8 / 3) < 1e-6);
  assert(Math.abs(output[0][4] - 5 / 3) < 1e-6);
  assert(Math.abs(output[0][5] - 6) < 1e-6);
});
