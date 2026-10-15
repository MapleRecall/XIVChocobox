import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Player } from '../dist/lib/player.js';

test('playback toggle sends pause or play from the Worklet state', async () => {
  const player = new Player(() => {}, () => {});
  let paused = 0, played = 0;
  player.state = { playing: true };
  player.pause = () => { paused++; };
  player.play = async () => { played++; };
  assert.equal(await player.togglePlayback(), false);
  assert.equal(paused, 1); assert.equal(played, 0);

  player.state = { playing: false };
  assert.equal(await player.togglePlayback(), true);
  assert.equal(paused, 1); assert.equal(played, 1);
});

test('manual seek keeps the current loop pass unless a pass is explicitly supplied', () => {
  const player = new Player(() => {}, () => {});
  player.context = { sampleRate: 48000 };
  let message;
  player.node = { port: { postMessage(value) { message = value; } } };
  player.seek(4.25);
  assert.deepEqual(message, { type: 'seek', position: 204000 });
  player.seek(4.25, 2);
  assert.deepEqual(message, { type: 'seek', position: 204000, pass: 2 });
});

test('preparing a restored track completes without waiting for autoplay permission', async () => {
  const player = new Player(() => {}, () => {});
  let resumes = 0;
  player.context = { resume() { resumes++; return new Promise(() => {}); } };
  player.ready = Promise.resolve();
  await player.prepare();
  assert.equal(resumes, 0);
  // Actual playback requests resume immediately, without awaiting preparation.
  void player.activate();
  assert.equal(resumes, 1);
});
