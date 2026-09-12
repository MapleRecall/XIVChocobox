import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeTexture, iconTexturePath, iconTexturePaths } from '../dist/lib/tex.js';

function tex(format, payload, width = 4, height = 4) {
  const bytes = new Uint8Array(80 + payload.length), data = new DataView(bytes.buffer);
  data.setUint32(0, 0x00800000, true); data.setUint16(4, format, true); data.setUint16(8, width, true); data.setUint16(10, height, true); data.setUint16(12, 1, true); data.setUint8(14, 1); data.setUint32(28, 80, true); bytes.set(payload, 80); return bytes;
}

test('uses the FFXIV icon texture path convention', () => {
  assert.equal(iconTexturePath(112033), 'ui/icon/112000/112033.tex');
  assert.deepEqual(iconTexturePaths(112033), ['ui/icon/112000/112033_hr1.tex', 'ui/icon/112000/112033.tex']);
});

test('decodes a BC3 texture into RGBA pixels', () => {
  const payload = new Uint8Array(16);
  payload.set([255, 0, 0, 0, 0, 0, 0, 0]);
  payload.set([0x00, 0xf8, 0xe0, 0x07, 0, 0, 0, 0], 8);
  const image = decodeTexture(tex(0x3431, payload));
  assert.deepEqual({ width: image.width, height: image.height }, { width: 4, height: 4 });
  assert.deepEqual([...image.rgba.slice(0, 4)], [255, 0, 0, 255]);
});
