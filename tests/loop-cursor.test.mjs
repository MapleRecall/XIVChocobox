import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LoopCursor } from '../dist/lib/loop-cursor.js';

function render(cursor, count = 64) {
  const samples = [];
  for (let i = 0; i < count && cursor.playing; i++) { samples.push(cursor.position); cursor.advance(); }
  return samples;
}
test('finite count includes first traversal, preserves intro and outro', () => {
  const c = new LoopCursor(10, { start: 2, end: 5 }, 3); c.play();
  assert.deepEqual(render(c), [0,1,2,3,4,2,3,4,2,3,4,5,6,7,8,9]);
  assert.equal(c.pass, 3); assert.equal(c.finished, true);
});
test('limit one never jumps', () => {
  const c = new LoopCursor(6, { start: 1, end: 5 }, 1); c.play();
  assert.deepEqual(render(c), [0,1,2,3,4,5]);
});
test('infinite loops at end of file and supports start at zero', () => {
  const c = new LoopCursor(3, { start: 0, end: 3 }, Infinity); c.play();
  assert.deepEqual(render(c, 10), [0,1,2,0,1,2,0,1,2,0]); assert.equal(c.finished, false);
});
test('no metadata does not turn infinite setting into whole-file repeat', () => {
  const c = new LoopCursor(3, null, Infinity); c.play(); assert.deepEqual(render(c), [0,1,2]);
});
test('pause resumes with same counter, restart resets counter', () => {
  const c = new LoopCursor(5, { start: 1, end: 3 }, 3); c.play(); render(c, 4); c.pause();
  const state = c.state(); c.advance(); assert.deepEqual(c.state(), state);
  c.play(); assert.deepEqual(render(c), [2,1,2,3,4]);
  c.play(); assert.equal(c.pass, 1); assert.equal(c.position, 0);
});
test('seeking into outro bypasses loops; seeking inside loop preserves count', () => {
  const c = new LoopCursor(10, { start: 2, end: 6 }, 3); c.play(); render(c, 8);
  assert.equal(c.pass, 2); c.seek(7); assert.deepEqual(render(c), [7,8,9]);
  c.seek(3); c.play(); assert.equal(c.pass, 2); assert.deepEqual(render(c), [3,4,5,2,3,4,5,6,7,8,9]);
});
test('infinite to finite finishes current pass if its count already exceeds limit', () => {
  const c = new LoopCursor(6, { start: 1, end: 4 }, Infinity); c.play(); render(c, 8); c.setLimit(1);
  assert.deepEqual(render(c), [2,3,4,5]); assert.equal(c.finished, true);
});
test('reject invalid counts and ignore invalid seek', () => {
  const c = new LoopCursor(5);
  for (const count of [0, -1, 1.1, NaN, 1000]) assert.throws(() => c.setLimit(count));
  c.seek(NaN); assert.equal(c.position, 0);
  c.play(); c.seek(5); assert.equal(c.playing, false);
});
