/* eslint-disable @typescript-eslint/no-explicit-any */
class InMemorySignalProtocolStore {
  private store = new Map<string, any>();

  async getIdentityKeyPair() {
    return this.store.get('identityKey');
  }

  async getLocalRegistrationId() {
    return this.store.get('registrationId');
  }

  async put(key: string, value: any) {
    this.store.set(key, value);
  }

  async get(key: string, defaultValue?: any) {
    if (this.store.has(key)) {
      return this.store.get(key);
    }
    return defaultValue;
  }

  async remove(key: string) {
    this.store.delete(key);
  }

  async isTrustedIdentity(identifier: string, _identityKey: ArrayBuffer) {
    const trusted = await this.get(`identity:${identifier}`);
    return trusted === undefined ? true : trusted === true;
  }

  async saveIdentity(identifier: string, identityKey: ArrayBuffer) {
    const existing = await this.get(`identity:${identifier}`);
    if (existing && existing.toString() !== identityKey.toString()) {
      throw new Error('Identity key changed for contact');
    }
    await this.put(`identity:${identifier}`, identityKey);
    return true;
  }
}

export const signalStore = new InMemorySignalProtocolStore();

export type PreKeyBundleRecord = {
  registrationId: number;
  identityKey: ArrayBuffer;
  signedPreKey: {
    keyId: number;
    publicKey: ArrayBuffer;
    signature: ArrayBuffer;
  };
  preKey?: {
    keyId: number;
    publicKey: ArrayBuffer;
  };
};

export const preKeyRegistry = new Map<string, PreKeyBundleRecord>();
