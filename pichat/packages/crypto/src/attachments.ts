import { XChaCha20Poly1305 } from '@stablelib/xchacha20poly1305';
import { getRandomBytes } from './random';
import { toBase64, fromBase64 } from '@pichat/utils';

export type AttachmentCiphertext = {
  data: Uint8Array;
  key: string;
  nonce: string;
};

export const encryptAttachment = (plaintext: Uint8Array): AttachmentCiphertext => {
  const key = getRandomBytes(32);
  const nonce = getRandomBytes(24);
  const cipher = new XChaCha20Poly1305(key);
  const data = cipher.seal(nonce, plaintext);
  return {
    data,
    key: toBase64(key),
    nonce: toBase64(nonce),
  };
};

export const decryptAttachment = (ciphertext: AttachmentCiphertext): Uint8Array => {
  const key = fromBase64(ciphertext.key);
  const nonce = fromBase64(ciphertext.nonce);
  const cipher = new XChaCha20Poly1305(key);
  const opened = cipher.open(nonce, ciphertext.data);
  if (!opened) {
    throw new Error('Failed to decrypt attachment');
  }
  return opened;
};
