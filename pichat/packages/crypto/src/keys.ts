import { KeyHelper } from 'libsignal-protocol';
import argon2 from 'argon2-browser';
import { XChaCha20Poly1305 } from '@stablelib/xchacha20poly1305';
import { sha256 } from '@noble/hashes/sha256';
import type { Identity, PreKey, PreKeyBundle, RecoveryKit } from '@pichat/types';
import { createUlid, now, toBase64 } from '@pichat/utils';
import { signalStore, preKeyRegistry } from './store';
import { getRandomBytes } from './random';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

let identityState: Identity | null = null;
let cachedPreKeys: PreKey[] = [];

const toHex = (data: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(data))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const arrayBufferToBase64 = (buffer: ArrayBuffer | Uint8Array) =>
  Buffer.from(buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)).toString('base64');

export const getIdentity = () => identityState;

export async function createIdentity(): Promise<{
  pub: string;
  privRef: string;
  fingerprint: string;
  registrationId: number;
}> {
  const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
  const registrationId = await KeyHelper.generateRegistrationId();
  await signalStore.put('identityKey', identityKeyPair);
  await signalStore.put('registrationId', registrationId);

  const pub = arrayBufferToBase64(identityKeyPair.pubKey);
  const priv = arrayBufferToBase64(identityKeyPair.privKey);
  const fingerprint = toHex(sha256(identityKeyPair.pubKey)).match(/.{1,4}/g)?.join(':') ?? '';

  identityState = {
    id: createUlid(),
    pubKey: pub,
    privRef: priv,
    fingerprint,
    createdAt: now(),
  };

  return {
    pub,
    privRef: priv,
    fingerprint,
    registrationId,
  };
}

export async function createPreKeys(n: number): Promise<PreKeyBundle[]> {
  const identityKeyPair = await signalStore.getIdentityKeyPair();
  const registrationId = await signalStore.getLocalRegistrationId();
  if (!identityKeyPair || !registrationId) {
    throw new Error('Identity must be initialized before generating pre-keys');
  }

  const bundles: PreKeyBundle[] = [];
  const signedPreKeyId = Math.floor(Math.random() * 100000) + 1;
  const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, signedPreKeyId);

  await signalStore.put(`signedPreKey${signedPreKeyId}`, signedPreKey);

  for (let i = 0; i < n; i += 1) {
    const keyId = signedPreKeyId + i + 1;
    const preKey = await KeyHelper.generatePreKey(keyId);
    await signalStore.put(`25519KeypreKey${keyId}`, preKey);

    const bundle: PreKeyBundle = {
      identityKey: arrayBufferToBase64(identityKeyPair.pubKey),
      signedPreKey: {
        id: signedPreKeyId,
        publicKey: arrayBufferToBase64(signedPreKey.keyPair.pubKey),
        signature: arrayBufferToBase64(signedPreKey.signature),
      },
      oneTimePreKey: {
        id: keyId,
        publicKey: arrayBufferToBase64(preKey.keyPair.pubKey),
      },
    };

    bundles.push(bundle);

    cachedPreKeys.push({
      id: keyId,
      type: 'one-time',
      pub: arrayBufferToBase64(preKey.keyPair.pubKey),
      privRef: arrayBufferToBase64(preKey.keyPair.privKey),
      used: false,
    });

    preKeyRegistry.set(bundle.identityKey, {
      registrationId,
      identityKey: identityKeyPair.pubKey,
      signedPreKey: {
        keyId: signedPreKeyId,
        publicKey: signedPreKey.keyPair.pubKey,
        signature: signedPreKey.signature,
      },
      preKey: {
        keyId,
        publicKey: preKey.keyPair.pubKey,
      },
    });
  }

  cachedPreKeys.push({
    id: signedPreKeyId,
    type: 'signed',
    pub: arrayBufferToBase64(signedPreKey.keyPair.pubKey),
    privRef: arrayBufferToBase64(signedPreKey.keyPair.privKey),
    used: false,
  });

  return bundles;
}

export async function exportRecoveryKit(passphrase: string): Promise<Uint8Array> {
  if (!identityState) {
    throw new Error('Identity not initialized');
  }

  const salt = getRandomBytes(16);
  const nonce = getRandomBytes(24);
  const argon = await argon2.hash({
    pass: passphrase,
    salt,
    type: argon2.ArgonType.Argon2id,
    hashLen: 32,
    time: 3,
    mem: 65536,
    parallelism: 1,
  });

  const key = new Uint8Array(argon.hash);
  const cipher = new XChaCha20Poly1305(key);

  const payload: RecoveryKit = {
    identity: identityState,
    preKeys: cachedPreKeys,
    exportedAt: now(),
    cipherParams: {
      salt: toBase64(salt),
      nonce: toBase64(nonce),
      iterations: 3,
    },
    ciphertext: '',
  };

  const plaintext = textEncoder.encode(JSON.stringify(payload));
  const sealed = cipher.seal(nonce, plaintext);
  payload.ciphertext = toBase64(sealed);

  return textEncoder.encode(JSON.stringify(payload));
}

export async function importRecoveryKit(blob: Uint8Array, passphrase: string): Promise<void> {
  const payload = JSON.parse(textDecoder.decode(blob)) as RecoveryKit;
  const salt = Buffer.from(payload.cipherParams.salt, 'base64');
  const nonce = Buffer.from(payload.cipherParams.nonce, 'base64');

  const argon = await argon2.hash({
    pass: passphrase,
    salt: new Uint8Array(salt).buffer as ArrayBuffer,
    type: argon2.ArgonType.Argon2id,
    hashLen: 32,
    time: payload.cipherParams.iterations,
    mem: 65536,
    parallelism: 1,
  });

  const cipher = new XChaCha20Poly1305(new Uint8Array(argon.hash));
  const plaintext = cipher.open(new Uint8Array(nonce), Buffer.from(payload.ciphertext, 'base64'));
  if (!plaintext) {
    throw new Error('Invalid recovery kit or passphrase');
  }

  const restored = JSON.parse(textDecoder.decode(plaintext)) as RecoveryKit;
  identityState = restored.identity;
  cachedPreKeys = restored.preKeys;

  const identityKeyPair = {
    pubKey: Buffer.from(restored.identity.pubKey, 'base64'),
    privKey: Buffer.from(restored.identity.privRef, 'base64'),
  } as unknown as { pubKey: ArrayBuffer; privKey: ArrayBuffer };

  await signalStore.put('identityKey', identityKeyPair);
  await signalStore.put('registrationId', 1);
}
