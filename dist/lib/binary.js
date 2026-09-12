export const utf8 = new TextDecoder();
export function view(bytes) { return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
export function ascii(bytes, offset, length) { return String.fromCharCode(...bytes.subarray(offset, offset + length)); }
export function requireRange(bytes, offset, length, label = '资源数据') {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > bytes.length) throw new Error(`${label}不完整或偏移无效，请确认游戏已更新完成。`);
}
export function cstring(bytes, offset, end = bytes.length) {
  requireRange(bytes, offset, 0);
  let stop = offset;
  while (stop < end && bytes[stop] !== 0) stop++;
  return utf8.decode(bytes.subarray(offset, stop));
}
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});
// SqPack uses CRC-32 without the usual final XOR, on lowercase paths.
export function pathHash(path) {
  let crc = 0xffffffff;
  for (const byte of new TextEncoder().encode(path.toLowerCase())) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return crc >>> 0;
}
export async function readRange(file, offset, length) {
  if (offset < 0 || length < 0 || offset + length > file.size) throw new Error(`文件 ${file.name} 不完整，读取范围超出文件。`);
  const bytes = new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
  if (bytes.length !== length) throw new Error(`文件 ${file.name} 读取不完整。`);
  return bytes;
}
