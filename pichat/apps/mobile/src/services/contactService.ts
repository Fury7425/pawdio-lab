import { registerPeerBundle } from '@pichat/crypto';
import type { Contact, Conversation, PreKeyBundle } from '@pichat/types';
import { contactRepository, conversationRepository } from '@pichat/storage';
import { useConversationsStore } from '../state/conversations';
import { createUlid, now } from '@pichat/utils';

export type ContactPayload = {
  displayName: string;
  pubKey: string;
  bundle: PreKeyBundle;
};

export const createContactUri = (payload: ContactPayload): string => {
  const encoded = encodeURIComponent(JSON.stringify(payload));
  return `pichat://contact?data=${encoded}`;
};

export const parseContactUri = (uri: string): ContactPayload => {
  const query = uri.split('data=')[1];
  if (!query) {
    throw new Error('Invalid contact URI');
  }
  return JSON.parse(decodeURIComponent(query)) as ContactPayload;
};

export const addContact = async (payload: ContactPayload): Promise<{
  contact: Contact;
  conversation: Conversation;
}> => {
  registerPeerBundle(payload.pubKey, payload.bundle);
  const contact: Contact = {
    id: payload.pubKey,
    displayName: payload.displayName,
    verified: false,
    createdAt: now(),
  };
  await contactRepository.upsert(contact);

  const conversation: Conversation = {
    id: createUlid(),
    peerId: payload.pubKey,
    topic: payload.bundle.identityKey,
    unreadCount: 0,
    lastMessageAt: null,
  };
  await conversationRepository.upsert(conversation);
  useConversationsStore.getState().upsert(conversation);

  return { contact, conversation };
};
