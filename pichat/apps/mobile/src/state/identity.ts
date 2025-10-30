import create from 'zustand';
import type { Identity } from '@pichat/types';

export type IdentityState = {
  identity: Identity | null;
  pin?: string;
  biometricEnabled: boolean;
  setIdentity: (identity: Identity) => void;
  clear: () => void;
  setSecurity: (pin: string | undefined, biometric: boolean) => void;
};

export const useIdentityStore = create<IdentityState>((set) => ({
  identity: null,
  biometricEnabled: false,
  setIdentity: (identity) => set({ identity }),
  clear: () => set({ identity: null, pin: undefined, biometricEnabled: false }),
  setSecurity: (pin, biometricEnabled) => set({ pin, biometricEnabled }),
}));
