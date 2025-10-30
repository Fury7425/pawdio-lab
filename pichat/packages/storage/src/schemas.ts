import type Realm from 'realm';

export const IdentitySchema: Realm.ObjectSchema = {
  name: 'Identity',
  primaryKey: 'id',
  properties: {
    id: 'string',
    pubKey: 'string',
    privRef: 'string',
    fingerprint: 'string',
    createdAt: 'int',
    rotatedAt: 'int?',
  },
};

export const ContactSchema: Realm.ObjectSchema = {
  name: 'Contact',
  primaryKey: 'id',
  properties: {
    id: 'string',
    displayName: 'string',
    alias: 'string?',
    verified: { type: 'bool', default: false },
    createdAt: 'int',
  },
};

export const ConversationSchema: Realm.ObjectSchema = {
  name: 'Conversation',
  primaryKey: 'id',
  properties: {
    id: 'string',
    peerId: 'string',
    topic: 'string',
    unreadCount: 'int',
    lastMessageAt: 'int?',
  },
  indexes: ['peerId', 'lastMessageAt'],
};

export const MessageSchema: Realm.ObjectSchema = {
  name: 'Message',
  primaryKey: 'id',
  properties: {
    id: 'string',
    conversationId: 'string',
    senderId: 'string',
    kind: 'string',
    ciphertext: 'string',
    status: 'string',
    sentAt: 'int',
    receivedAt: 'int?',
  },
  indexes: ['conversationId', 'sentAt'],
};

export const AttachmentSchema: Realm.ObjectSchema = {
  name: 'Attachment',
  primaryKey: 'id',
  properties: {
    id: 'string',
    messageId: 'string',
    cipherUri: 'string',
    wrappedKey: 'string',
    size: 'int',
    mime: 'string',
    width: 'int?',
    height: 'int?',
  },
  indexes: ['messageId'],
};

export const PreKeySchema: Realm.ObjectSchema = {
  name: 'PreKey',
  primaryKey: 'id',
  properties: {
    id: 'int',
    type: 'string',
    pub: 'string',
    privRef: 'string',
    used: { type: 'bool', default: false },
  },
};

export const Schemas = [
  IdentitySchema,
  ContactSchema,
  ConversationSchema,
  MessageSchema,
  AttachmentSchema,
  PreKeySchema,
];
