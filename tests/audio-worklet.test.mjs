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

test('changing tracks disposes the processor and releases PCM', () => {
  const processor = new Processor();
  processor.port.onmessage({ data: { type: 'load', channels: [new Float32Array(1000)], loop: null, limit: 1, trackId: 1 } });
  processor.port.onmessage({ data: { type: 'dispose' } });
  assert.equal(processor.channels.length, 0);
  assert.equal(processor.process([], [[new Float32Array(128)]]), false);
});
