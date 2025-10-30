import { describe, it, expect, vi, beforeEach } from '@jest/globals';
import { publish, subscribe, startWaku } from '../src/waku';
import type { EncryptedEnvelope } from '@pichat/types';

vi.mock('js-waku', () => {
  const subscribers = new Map<string, Set<(msg: { payload?: Uint8Array }) => void>>();
  const mockNode = {
    start: vi.fn(async () => undefined),
    relay: {
      send: vi.fn(async (encoder: { contentTopic: string }, message: { payload?: Uint8Array }) => {
        const set = subscribers.get(encoder.contentTopic);
        set?.forEach((cb) => cb({ payload: message.payload }));
      }),
      subscribe: vi.fn(async ([decoder]: [{ contentTopic: string }], cb: (msg: { payload?: Uint8Array }) => void) => {
        const set = subscribers.get(decoder.contentTopic) ?? new Set();
        set.add(cb);
        subscribers.set(decoder.contentTopic, set);
      }),
      unsubscribe: vi.fn(async ([decoder]: [{ contentTopic: string }], cb: (msg: { payload?: Uint8Array }) => void) => {
        const set = subscribers.get(decoder.contentTopic);
        set?.delete(cb);
      }),
    },
  };

  return {
    createLightNode: vi.fn(async () => mockNode),
    waitForRemotePeer: vi.fn(async () => undefined),
    createEncoder: ({ contentTopic }: { contentTopic: string }) => ({ contentTopic }),
    createDecoder: (contentTopic: string) => ({ contentTopic }),
  };
});

const envelope: EncryptedEnvelope = {
  header: {
    topic: 'test-topic',
    sender: 'sender',
    timestamp: Date.now(),
  },
  body: Buffer.from(JSON.stringify({ message: 'hello' })).toString('base64'),
};

describe('network waku module', () => {
  beforeEach(async () => {
    await startWaku();
  });

  it('notifies subscribers when publishing', async () => {
    const spy = vi.fn();
    const unsubscribe = await subscribe('test-topic', spy);
    await publish('test-topic', envelope);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(envelope);
    unsubscribe();
  });
});
