import { generateRecoveryKit, restoreFromRecoveryKit } from './cryptoClient';

export const exportRecovery = async (passphrase: string) => generateRecoveryKit(passphrase);

export const importRecovery = async (blob: Uint8Array, passphrase: string) => {
  await restoreFromRecoveryKit(blob, passphrase);
};
