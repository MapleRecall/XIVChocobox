/*
 * HCA header parser.
 *
 * CRI's HCA container is a flat sequence of fourCC-tagged sub-
 * headers followed by `blockCount` fixed-size encoded blocks.
 * Every sub-header tag's top bits may be flipped (set to 1) for
 * obfuscation purposes — we mask with 0x7F7F7F7F before
 * comparison so both the "clean" and "Square XOR-flipped"
 * variants parse the same way.
 *
 * Sub-headers in order (all optional except `HCA\0` and `fmt\0`):
 *
 *   `HCA\0`  base header (version, dataOffset)
 *   `fmt\0`  channel count, samplerate, block count, mute counts
 *   `comp`   compression params (r01..r08)  OR
 *   `dec\0`  alternative compression params
 *   `vbr\0`  variable-bitrate params
 *   `ath\0`  ATH (absolute threshold of hearing) curve type
 *   `loop`   loop start/end/count
 *   `ciph`   cipher type (0/1/56)
 *   `rva\0`  master volume (float BE)
 *   `comm`   user comment string
 *   `pad\0`  padding to dataOffset
 *
 * Ported from kohos/CriTools (MIT) — https://github.com/kohos/CriTools
 */
/**
 * Cheap magic check: does the first 4 bytes look like the HCA
 * `HCA\0` signature (mask the top bits since CriWare sometimes
 * XORs them).
 */
export function isHca(bytes) {
    if (bytes.byteLength < 4)
        return false;
    // Mask off top bit per byte, then compare to little-endian
    // "HCA\0" (= 0x00414348).
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const sig = v.getUint32(0, true) & 0x7f7f7f7f;
    return sig === 0x00414348;
}
/** Thrown for malformed / non-HCA inputs. */
export class HcaParseError extends Error {
    constructor(message) {
        super(message);
        this.name = 'HcaParseError';
    }
}
/**
 * Parse an HCA file's header. Does NOT touch the encoded
 * blocks. Throws {@link HcaParseError} if the buffer isn't an
 * HCA or contains an out-of-range field.
 */
export function parseHca(bytes) {
    if (!bytes || bytes.byteLength < 8) {
        throw new HcaParseError('Buffer too small to contain an HCA header');
    }
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let pos = 0;
    // `HCA\0`
    const magic = v.getUint32(pos, true);
    pos += 4;
    if ((magic & 0x7f7f7f7f) !== 0x00414348) {
        throw new HcaParseError('Not an HCA file (bad magic)');
    }
    const version = v.getUint16(pos, false);
    pos += 2;
    const dataOffset = v.getUint16(pos, false);
    pos += 2;
    // `fmt\0`
    const fmtTag = v.getUint32(pos, true);
    pos += 4;
    if ((fmtTag & 0x7f7f7f7f) !== 0x00746d66) {
        throw new HcaParseError('Missing/bad `fmt` header');
    }
    const channelCount = v.getUint8(pos);
    const samplingRate = v.getUint32(pos, false) & 0xffffff;
    pos += 4;
    const blockCount = v.getUint32(pos, false);
    pos += 4;
    const muteHeader = v.getUint16(pos, false);
    pos += 2;
    const muteFooter = v.getUint16(pos, false);
    pos += 2;
    if (!(channelCount >= 1 && channelCount <= 16)) {
        throw new HcaParseError(`Bad channelCount: ${channelCount}`);
    }
    if (!(samplingRate >= 1 && samplingRate <= 0x7fffff)) {
        throw new HcaParseError(`Bad samplingRate: ${samplingRate}`);
    }
    // `comp` or `dec\0`
    let label = v.getUint32(pos, true);
    pos += 4;
    const blockSize = v.getUint16(pos, false);
    pos += 2;
    const r01 = v.getUint8(pos++);
    const r02 = v.getUint8(pos++);
    let r03 = 0;
    let r04 = 0;
    let r05 = 0;
    let r06 = 0;
    let r07 = 0;
    let r08 = 0;
    let count1;
    let count2;
    let enableCount2;
    let compdec;
    if ((label & 0x7f7f7f7f) === 0x706d6f63) {
        // "comp"
        compdec = 'comp';
        r03 = v.getUint8(pos++);
        r04 = v.getUint8(pos++);
        r05 = v.getUint8(pos++);
        r06 = v.getUint8(pos++);
        r07 = v.getUint8(pos++);
        r08 = v.getUint8(pos++);
        pos += 2; // reserve1, reserve2
    }
    else if ((label & 0x7f7f7f7f) === 0x00636564) {
        // "dec\0"
        compdec = 'dec';
        count1 = v.getUint8(pos++);
        count2 = v.getUint8(pos++);
        const packed = v.getUint8(pos++);
        r03 = (packed >>> 4) & 0xf;
        r04 = packed & 0xf;
        enableCount2 = v.getUint8(pos++);
    }
    else {
        throw new HcaParseError(`Expected 'comp' or 'dec ' chunk; got 0x${(label & 0x7f7f7f7f).toString(16)}`);
    }
    if (!((blockSize >= 1 && blockSize <= 0xffff) || blockSize === 0)) {
        throw new HcaParseError(`Bad blockSize: ${blockSize}`);
    }
    if (!(r01 >= 0 && r01 <= r02 && r02 <= 0x1f)) {
        throw new HcaParseError(`Bad r01/r02: ${r01}/${r02}`);
    }
    // Subsequent sub-headers are all optional. We advance `pos`
    // only past tags that actually match.
    let vbrR1;
    let vbrR2;
    label = v.getUint32(pos, true);
    pos += 4;
    if ((label & 0x7f7f7f7f) === 0x00726276) {
        // "vbr\0"
        vbrR1 = v.getUint16(pos, false);
        pos += 2;
        vbrR2 = v.getUint16(pos, false);
        pos += 2;
        if (!(blockSize === 0 && vbrR1 >= 0 && vbrR2 <= 0x1ff)) {
            throw new HcaParseError('Bad vbr params');
        }
        label = v.getUint32(pos, true);
        pos += 4;
    }
    let athType;
    if ((label & 0x7f7f7f7f) === 0x00687461) {
        // "ath\0"
        athType = v.getUint16(pos, false);
        pos += 2;
        label = v.getUint32(pos, true);
        pos += 4;
    }
    else {
        athType = version < 0x200 ? 1 : 0;
    }
    let loopStart;
    let loopEnd;
    let loopCount;
    let loopR1;
    if ((label & 0x7f7f7f7f) === 0x706f6f6c) {
        // "loop"
        loopStart = v.getUint32(pos, false);
        pos += 4;
        loopEnd = v.getUint32(pos, false);
        pos += 4;
        loopCount = v.getUint16(pos, false);
        pos += 2;
        if (!(loopStart <= loopEnd && loopEnd <= blockCount)) {
            throw new HcaParseError('Bad loop range');
        }
        loopR1 = v.getUint16(pos, false);
        pos += 2;
        label = v.getUint32(pos, true);
        pos += 4;
    }
    let ciphType = 0;
    if ((label & 0x7f7f7f7f) === 0x68706963) {
        // "ciph"
        ciphType = v.getUint16(pos, false);
        pos += 2;
        if (!(ciphType === 0 || ciphType === 1 || ciphType === 56)) {
            throw new HcaParseError(`Bad ciph type: ${ciphType}`);
        }
        label = v.getUint32(pos, true);
        pos += 4;
    }
    let volume;
    if ((label & 0x7f7f7f7f) === 0x00617672) {
        // "rva\0"
        volume = v.getFloat32(pos, false);
        pos += 4;
        label = v.getUint32(pos, true);
        pos += 4;
    }
    else {
        volume = 1;
    }
    let comment;
    if ((label & 0x7f7f7f7f) === 0x6d6d6f63) {
        // "comm"
        const commLen = v.getUint8(pos);
        pos += 1;
        if (commLen) {
            const slice = bytes.subarray(pos, pos + commLen);
            comment = new TextDecoder('utf-8', { fatal: false }).decode(slice);
            pos += commLen;
        }
        label = v.getUint32(pos, true);
        pos += 4;
    }
    // "pad\0" — final padding tag; no payload to consume.
    if ((label & 0x7f7f7f7f) === 0x00646170) {
        // Just acknowledge; nothing to read.
    }
    return {
        version,
        dataOffset,
        channelCount,
        samplingRate,
        blockCount,
        blockSize,
        muteHeader,
        muteFooter,
        compdec,
        r01,
        r02,
        r03,
        r04,
        r05,
        r06,
        r07,
        r08,
        count1,
        count2,
        enableCount2,
        vbrR1,
        vbrR2,
        athType,
        loopStart,
        loopEnd,
        loopCount,
        loopR1,
        ciphType,
        volume,
        comment,
    };
}
