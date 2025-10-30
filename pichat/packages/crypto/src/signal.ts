import {
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
} from 'libsignal-protocol';
import type { EncryptedEnvelope, PreKeyBundle } from '@pichat/types';
import { now } from '@pichat/utils';
import { signalStore, preKeyRegistry, type PreKeyBundleRecord } from './store';
import { getIdentity } from './keys';
import { sha256 } from '@noble/hashes/sha256';

const textEncoder = new TextEncoder();

const activeSessions = new Set<string>();

const deriveTopic = (peerPub: string) => {
  const identity = getIdentity();
  const values = [peerPub, identity?.pubKey ?? ''].sort();
  const hash = sha256(textEncoder.encode(values.join(':')));
  return Array.from(hash)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 48);
};

const toBase64 = (value: ArrayBuffer | Uint8Array) =>
  Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value)).toString('base64');

const fromBase64 = (value: string) => new Uint8Array(Buffer.from(value, 'base64'));

const getAddress = (peerPub: string) => new SignalProtocolAddress(peerPub, 1);

export const registerPeerBundle = (peerPub: string, bundle: PreKeyBundle) => {
  const record: PreKeyBundleRecord = {
    registrationId: 0,
    identityKey: Buffer.from(bundle.identityKey, 'base64'),
    signedPreKey: {
      keyId: bundle.signedPreKey.id,
      publicKey: Buffer.from(bundle.signedPreKey.publicKey, 'base64'),
      signature: Buffer.from(bundle.signedPreKey.signature, 'base64'),
    },
    preKey: bundle.oneTimePreKey
      ? {
          keyId: bundle.oneTimePreKey.id,
          publicKey: Buffer.from(bundle.oneTimePreKey.publicKey, 'base64'),
        }
      : undefined,
  };
  preKeyRegistry.set(peerPub, record);
};

export async function ensureSession(peerPub: string): Promise<void> {
  if (activeSessions.has(peerPub)) {
    return;
  }
  const bundle = preKeyRegistry.get(peerPub);
  if (!bundle) {
    throw new Error('Missing pre-key bundle for peer');
  }

  const builder = new SessionBuilder(signalStore as never, getAddress(peerPub));
  await builder.processPreKey(bundle as never);
  activeSessions.add(peerPub);
}

export async function encryptFor(peerPub: string, msg: Uint8Array): Promise<EncryptedEnvelope> {
  await ensureSession(peerPub);
  const cipher = new SessionCipher(signalStore as never, getAddress(peerPub));
  const payload = await cipher.encrypt(msg);

  const envelopePayload = {
    type: payload.type,
    body: toBase64(payload.body),
  };

  return {
    header: {
      topic: deriveTopic(peerPub),
      sender: getIdentity()?.pubKey ?? 'unknown',
      timestamp: now(),
    },
    body: Buffer.from(JSON.stringify(envelopePayload)).toString('base64'),
  };
}

export async function decryptFrom(peerPub: string, env: EncryptedEnvelope): Promise<Uint8Array> {
  await ensureSession(peerPub);
  const cipher = new SessionCipher(signalStore as never, getAddress(peerPub));
  const decoded = JSON.parse(Buffer.from(env.body, 'base64').toString('utf8')) as {
    type: number;
    body: string;
  };

  const body = fromBase64(decoded.body);
  if (decoded.type === 3) {
    const plaintext = await cipher.decryptPreKeyWhisperMessage(body, 'binary');
    return new Uint8Array(plaintext);
  }
  const plaintext = await cipher.decryptWhisperMessage(body, 'binary');
  return new Uint8Array(plaintext);
}
