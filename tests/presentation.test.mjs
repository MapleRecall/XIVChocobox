import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { cleanTitle, summarizeMetadata } from '../dist/lib/presentation.js';

test('cleans annotations from each merged title but preserves interior stars', () => {
  assert.equal(cleanTitle('绚烂* / 天界**  '), '绚烂 / 天界');
  assert.equal(cleanTitle('A*B'), 'A*B');
  assert.equal(cleanTitle('星光'), '星光');
});
test('preset catalog summaries retain parser loop and variant decisions', async () => {
  const { schemaVersion, tracks } = JSON.parse(await readFile(new URL('../dist/data/track-metadata.json', import.meta.url)));
  assert.equal(schemaVersion, 1);
  assert(Object.keys(tracks).length > 2000);
  for (const [path, value] of Object.entries(tracks)) {
    assert.equal(path, path.toLowerCase());
    assert(!('ogg' in value));
    assert('coverTextureId' in value && 'coverTexturePath' in value);
    assert(Array.isArray(value.dungeons));
    assert(Array.isArray(value.coverTextureIds) && Array.isArray(value.coverTexturePaths));
    if (value.supported) {
      assert(value.duration > 0);
      assert.equal(value.duration, value.totalSamples / value.sampleRate);
      if (value.loop) assert(value.loop.start / value.sampleRate > .5 || (value.totalSamples - value.loop.end) / value.sampleRate > .5);
    }
  }
  const tower = summarizeMetadata(tracks['music/ffxiv/bgm_con_crystaltower_02.scd']);
  assert(tower.ready && tower.hasLoop && tower.hasVariant);
  assert.equal(tower.channels, 6);
  assert.deepEqual(tracks['music/ffxiv/bgm_con_crystaltower_01.scd'].dungeons, ['水晶塔 古代人迷宫']);
  assert.deepEqual(tracks['music/ffxiv/bgm_con_crystaltower_01.scd'].coverTextureIds, [112033]);
  assert.deepEqual(tracks['music/ffxiv/bgm_dungeon_ish_02.scd'].dungeons, ['泽梅尔要塞']);
  assert.deepEqual(tracks['music/ffxiv/bgm_dungeon_ish_02.scd'].coverTextureIds, [112013]);
});
