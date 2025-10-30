export const getRandomBytes = (length: number): Uint8Array => {
  if (globalThis.crypto && 'getRandomValues' in globalThis.crypto) {
    const buffer = new Uint8Array(length);
    globalThis.crypto.getRandomValues(buffer);
    return buffer;
  }

  // Node.js fallback
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { randomBytes } = require('crypto');
  return new Uint8Array(randomBytes(length));
};
