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
