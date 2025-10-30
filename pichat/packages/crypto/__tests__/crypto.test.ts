import { describe, it, expect } from '@jest/globals';
import {
  createIdentity,
  createPreKeys,
  encryptFor,
  decryptFrom,
  exportRecoveryKit,
  importRecoveryKit,
  registerPeerBundle,
} from '../src';
import type { PreKeyBundle } from '@pichat/types';

const encoder = new TextEncoder();

describe('crypto package', () => {
  it('creates identity and pre-keys', async () => {
    const identity = await createIdentity();
    expect(identity.pub).toBeDefined();
    const bundles = await createPreKeys(2);
    expect(bundles).toHaveLength(2);
  });

  it('encrypts and decrypts messages when peer bundle registered', async () => {
    const identity = await createIdentity();
    const bundles = await createPreKeys(1);
    const peerBundle: PreKeyBundle = bundles[0];
    registerPeerBundle(identity.pub, peerBundle);
    const plaintext = encoder.encode('hello secure world');
    const envelope = await encryptFor(identity.pub, plaintext);
    const decrypted = await decryptFrom(identity.pub, envelope);
    expect(new TextDecoder().decode(decrypted)).toBe('hello secure world');
  });

  it('exports and imports a recovery kit', async () => {
    const kit = await exportRecoveryKit('password123');
    await importRecoveryKit(kit, 'password123');
    expect(kit.byteLength).toBeGreaterThan(10);
  });
});
