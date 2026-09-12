import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SqPack } from '../dist/lib/sqpack.js';

const file = { kind: 'file' };
function directory(entries, name = '') { return { kind: 'directory', name, async *entries() { yield* entries; } }; }
const base = directory([['0a0000.win32.index', file], ['0c0000.win32.index2', file], ['0c0000.win32.dat0', file]], 'sqpack');
const game = entries => directory([['sqpack', directory(entries, 'sqpack')]], 'game');
test('selecting the game root discovers base and expansion repositories', async () => {
  const selected = directory([['game', game([['ffxiv', base], ['ex1', directory([['0c0100.win32.index2', file], ['0c0100.win32.dat0', file]], 'ex1')], ['other', directory([['private.txt', file]], 'other')]])]], 'FFXIV');
  const pack = await SqPack.fromDirectory(selected);
  assert(pack.files.has('ffxiv/0a0000.win32.index'));
  assert(pack.files.has('ex1/0c0100.win32.dat0'));
  assert.equal(pack.files.size, 5);
});
test('selecting the game folder is also supported', async () => {
  const pack = await SqPack.fromDirectory(game([['ffxiv', base]]));
  assert.equal(pack.files.size, 3); assert(pack.files.has('ffxiv/0c0000.win32.dat0'));
});
test('selecting a nested resource folder is rejected', async () => {
  await assert.rejects(() => SqPack.fromDirectory(base), /游戏根目录或 game 文件夹/);
});
test('unrelated folder is rejected without traversing unrelated directories', async () => {
  await assert.rejects(() => SqPack.fromDirectory(directory([['documents', directory([])]])), /请选择/);
});
