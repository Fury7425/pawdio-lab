import { describe, it, expect, beforeEach, vi } from '@jest/globals';
import type Realm from 'realm';

class MockRealm {
  data = new Map<string, any[]>();

  constructor(public schema: Realm.ObjectSchema[]) {}

  static objects = new Map<string, any[]>();

  write(fn: () => void) {
    fn();
  }

  objects<T>(name: string) {
    const list = MockRealm.objects.get(name) ?? [];
    return list as unknown as Realm.Results<Realm.Object & T>;
  }

  create(name: string, value: any) {
    const list = MockRealm.objects.get(name) ?? [];
    const existingIndex = list.findIndex((item) => item.id === value.id);
    if (existingIndex >= 0) {
      list[existingIndex] = { ...list[existingIndex], ...value };
    } else {
      list.push({ ...value });
    }
    MockRealm.objects.set(name, list);
  }

  objectForPrimaryKey<T>(_name: string, id: string) {
    const list = MockRealm.objects.get(_name) ?? [];
    return list.find((item) => item.id === id) ?? null;
  }
}

vi.mock('realm', () => ({
  default: MockRealm,
  __esModule: true,
}));

import { identityRepository, messageRepository, conversationRepository } from '../src';

const identity = {
  id: 'id1',
  pubKey: 'pub',
  privRef: 'priv',
  fingerprint: 'aa:bb',
  createdAt: 1,
};

describe('storage repository', () => {
  beforeEach(() => {
    MockRealm.objects.clear();
  });

  it('stores and retrieves identity', async () => {
    await identityRepository.upsert(identity);
    const result = await identityRepository.get();
    expect(result?.pubKey).toBe('pub');
  });

  it('stores messages and lists them by conversation', async () => {
    await messageRepository.add({
      id: 'm1',
      conversationId: 'c1',
      senderId: 'me',
      kind: 'text',
      ciphertext: 'abc',
      status: 'sent',
      sentAt: 2,
    });
    await messageRepository.add({
      id: 'm2',
      conversationId: 'c1',
      senderId: 'peer',
      kind: 'text',
      ciphertext: 'def',
      status: 'delivered',
      sentAt: 3,
    });

    const messages = await messageRepository.list('c1');
    expect(messages).toHaveLength(2);
  });

  it('increments unread counts', async () => {
    await conversationRepository.upsert({
      id: 'conv',
      peerId: 'peer',
      topic: 'topic',
      unreadCount: 0,
      lastMessageAt: 0,
    });
    await conversationRepository.incrementUnread('conv');
    const conversations = await conversationRepository.list();
    expect(conversations[0].unreadCount).toBe(1);
  });
});
