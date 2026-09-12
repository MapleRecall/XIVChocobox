import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqPack } from '../dist/lib/sqpack.js';

const file = { kind: 'file' };
function directory(entries) { return { kind: 'directory', async *entries() { yield* entries; } }; }
const base = directory([['0a0000.win32.index', file], ['0c0000.win32.index2', file], ['0c0000.win32.dat0', file]]);
test('selecting sqpack discovers base and expansion repositories', async () => {
  const pack = await SqPack.fromDirectory(directory([['ffxiv', base], ['ex1', directory([['0c0100.win32.index2', file], ['0c0100.win32.dat0', file]])], ['other', directory([['private.txt', file]])]]));
  assert(pack.files.has('ffxiv/0a0000.win32.index'));
  assert(pack.files.has('ex1/0c0100.win32.dat0'));
  assert.equal(pack.files.size, 5);
});
test('selecting only ffxiv remains supported', async () => {
  const pack = await SqPack.fromDirectory(base);
  assert.equal(pack.files.size, 3); assert(pack.files.has('ffxiv/0c0000.win32.dat0'));
});
test('unrelated folder is rejected without traversing unrelated directories', async () => {
  await assert.rejects(() => SqPack.fromDirectory(directory([['documents', directory([])]])), /请选择/);
});
