import {
  createIdentity as createIdentityKeys,
  createPreKeys,
  exportRecoveryKit,
  importRecoveryKit,
} from '@pichat/crypto';
import type { Identity } from '@pichat/types';
import { identityRepository, preKeyRepository } from '@pichat/storage';
import { useIdentityStore } from '../state/identity';
import { createUlid, now } from '@pichat/utils';

export const initializeIdentity = async (): Promise<Identity> => {
  const existing = await identityRepository.get();
  if (existing) {
    useIdentityStore.getState().setIdentity(existing);
    return existing;
  }

  const identity = await createIdentityKeys();
  const model: Identity = {
    id: createUlid(),
    pubKey: identity.pub,
    privRef: identity.privRef,
    fingerprint: identity.fingerprint,
    createdAt: now(),
  };

  await identityRepository.upsert(model);
  useIdentityStore.getState().setIdentity(model);

  const bundles = await createPreKeys(5);
  await Promise.all(
    bundles.map(async (bundle) => {
      if (!bundle.oneTimePreKey) {
        return;
      }
      await preKeyRepository.upsert({
        id: bundle.oneTimePreKey.id,
        type: 'one-time',
        pub: bundle.oneTimePreKey.publicKey,
        privRef: 'secure-store',
        used: false,
      });
    }),
  );

  return model;
};

export const generateRecoveryKit = async (passphrase: string) => exportRecoveryKit(passphrase);

export const restoreFromRecoveryKit = async (blob: Uint8Array, passphrase: string) => {
  await importRecoveryKit(blob, passphrase);
  const identity = await identityRepository.get();
  if (identity) {
    useIdentityStore.getState().setIdentity(identity);
  }
};
