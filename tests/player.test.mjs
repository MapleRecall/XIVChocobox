import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../dist/lib/player.js';

test('playback toggle pauses from cursor state even when AudioContext is suspended', async () => {
  const player = new Player(() => {}, () => {});
  let paused = 0, played = 0;
  player.state = { playing: true }; player.playbackIntent = true;
  player.pause = () => { paused++; };
  player.play = async () => { played++; };
  assert.equal(await player.togglePlayback(), false);
  assert.equal(paused, 1); assert.equal(played, 0);
});

test('playback toggle also pauses when a delayed Worklet report still says playing', async () => {
  const player = new Player(() => {}, () => {});
  let paused = 0, played = 0;
  player.state = { playing: true }; player.playbackIntent = false;
  player.pause = () => { paused++; };
  player.play = async () => { played++; };
  assert.equal(await player.togglePlayback(), false);
  assert.equal(paused, 1); assert.equal(played, 0);
});

test('playback toggle resumes when the cursor is paused', async () => {
  const player = new Player(() => {}, () => {});
  let paused = 0, played = 0;
  player.state = { playing: false };
  player.pause = () => { paused++; };
  player.play = async () => { played++; };
  assert.equal(await player.togglePlayback(), true);
  assert.equal(paused, 0); assert.equal(played, 1);
});

test('stale Worklet playing state cannot undo a local pause intent', () => {
  const player = new Player(() => {}, () => {});
  player.playbackIntent = false;
  player.applyWorkletState({ type: 'state', trackId: 1, position: 10, playing: true, finished: false }, 1);
  assert.equal(player.state.playing, false);
});

test('finished Worklet state clears the playback intent for replay', () => {
  const player = new Player(() => {}, () => {});
  player.playbackIntent = true;
  player.applyWorkletState({ type: 'state', trackId: 1, position: 10, playing: false, finished: true }, 1);
  assert.equal(player.state.playing, false); assert.equal(player.playbackIntent, false);
});

test('pause suspends the audio context as a reliable stop fallback', async () => {
  const player = new Player(() => {}, () => {});
  let suspended = 0;
  player.context = { state: 'running', suspend: async () => { suspended++; } };
  player.node = { port: { postMessage() {} } };
  player.playbackIntent = true;
  player.pause();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(suspended, 1); assert.equal(player.state.playing, false);
});

test('toggle treats a running track with a delayed state report as playing', async () => {
  const player = new Player(() => {}, () => {});
  let paused = 0;
  player.context = { state: 'running' };
  player.node = { port: { postMessage() {} } };
  player.state = { playing: false, finished: false, position: 12 };
  player.pause = () => { paused++; };
  assert.equal(player.isPlaying(), true);
  assert.equal(await player.togglePlayback(), false); assert.equal(paused, 1);
});

test('pause closes the output gate before the Worklet command is processed', () => {
  const player = new Player(() => {}, () => {});
  const calls = [];
  player.context = { state: 'suspended', currentTime: 4, suspend: async () => {} };
  player.gain = { gain: { cancelScheduledValues: time => calls.push(['cancel', time]), setValueAtTime: (value, time) => calls.push(['set', value, time]) } };
  player.pause();
  assert.deepEqual(calls, [['cancel', 4], ['set', 0, 4]]);
});
