import { describe, it, expect } from '@jest/globals';
import { chunkBuffer, createUlid, fromBase64, toBase64 } from '../src';

describe('utils', () => {
  it('chunks buffers correctly', () => {
    const buffer = new Uint8Array([1, 2, 3, 4, 5]);
    const chunks = chunkBuffer(buffer, 2);
    expect(chunks).toHaveLength(3);
    expect(Array.from(chunks[2])).toEqual([5]);
  });

  it('roundtrips base64 encoding', () => {
    const original = new Uint8Array([104, 105]);
    const encoded = toBase64(original);
    const decoded = fromBase64(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it('generates ulid strings', () => {
    const id = createUlid();
    expect(id).toHaveLength(26);
  });
});
