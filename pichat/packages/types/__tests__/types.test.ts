import { describe, it, expect } from '@jest/globals';
import type { Message } from '../src';

describe('types', () => {
  it('allows creation of a message shape', () => {
    const message: Message = {
      id: '01HZYQ7J5GQ8R6AC2N7XY1V4FZ',
      conversationId: 'conv1',
      senderId: 'peer1',
      kind: 'text',
      ciphertext: 'base64:abcd',
      status: 'pending',
      sentAt: Date.now(),
    };

    expect(message.kind).toBe('text');
  });
});
