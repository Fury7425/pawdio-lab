import { encryptFor, decryptFrom, ensureSession } from '@pichat/crypto';
import { publish, subscribe } from '@pichat/network';
import type { EncryptedEnvelope, Message } from '@pichat/types';
import { messageRepository, conversationRepository } from '@pichat/storage';
import { useMessagesStore } from '../state/messages';
import { useConversationsStore } from '../state/conversations';
import { useIdentityStore } from '../state/identity';
import { createUlid, now } from '@pichat/utils';
import { formatTime } from '../utils/time';

export const sendMessage = async (
  conversationId: string,
  peerPublicKey: string,
  plaintext: string,
): Promise<Message> => {
  const sender = useIdentityStore.getState().identity;
  if (!sender) {
    throw new Error('Identity not initialized');
  }

  await ensureSession(peerPublicKey);
  const envelope = await encryptFor(peerPublicKey, new TextEncoder().encode(plaintext));
  await publish(envelope.header.topic, envelope);

  const message: Message = {
    id: createUlid(),
    conversationId,
    senderId: sender.pubKey,
    kind: 'text',
    ciphertext: envelope.body,
    status: 'sent',
    sentAt: now(),
  };

  await messageRepository.add(message);
  useMessagesStore.getState().addMessage(message);
  await conversationRepository.upsert({
    id: conversationId,
    peerId: peerPublicKey,
    topic: envelope.header.topic,
    unreadCount: 0,
    lastMessageAt: message.sentAt,
  });
  useConversationsStore.getState().upsert({
    id: conversationId,
    peerId: peerPublicKey,
    topic: envelope.header.topic,
    unreadCount: 0,
    lastMessageAt: message.sentAt,
  });

  return message;
};

export const subscribeToConversation = async (
  peerPublicKey: string,
  conversationId: string,
  onMessage: (message: Message) => void,
): Promise<() => void> => {
  const unsubscribe = await subscribe(peerPublicKey, async (envelope: EncryptedEnvelope) => {
    const sender = envelope.header.sender;
    const plaintext = await decryptFrom(peerPublicKey, envelope);
    const message: Message = {
      id: createUlid(),
      conversationId,
      senderId: sender,
      kind: 'text',
      ciphertext: envelope.body,
      status: 'delivered',
      sentAt: envelope.header.timestamp,
      receivedAt: now(),
    };
    await messageRepository.add(message);
    useMessagesStore.getState().addMessage(message);
    useConversationsStore.getState().incrementUnread(conversationId);
    await conversationRepository.incrementUnread(conversationId);
    onMessage(message);
  });

  return unsubscribe;
};

export const formatMessage = (message: Message) => ({
  ...message,
  displayTime: formatTime(message.sentAt),
});
