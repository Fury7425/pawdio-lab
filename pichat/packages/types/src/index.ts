export type Identity = {
  id: string;
  pubKey: string;
  privRef: string;
  fingerprint: string;
  createdAt: number;
  rotatedAt?: number;
};

export type Contact = {
  id: string;
  displayName: string;
  alias?: string;
  verified: boolean;
  createdAt: number;
};

export type Conversation = {
  id: string;
  peerId: string;
  topic: string;
  unreadCount: number;
  lastMessageAt: number | null;
};

export type MessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed';

export type MessageKind = 'text' | 'attachment' | 'system';

export type Message = {
  id: string;
  conversationId: string;
  senderId: string;
  kind: MessageKind;
  ciphertext: string;
  status: MessageStatus;
  sentAt: number;
  receivedAt?: number;
};

export type Attachment = {
  id: string;
  messageId: string;
  cipherUri: string;
  wrappedKey: string;
  size: number;
  mime: string;
  width?: number;
  height?: number;
};

export type PreKeyType = 'signed' | 'one-time';

export type PreKey = {
  id: number;
  type: PreKeyType;
  pub: string;
  privRef: string;
  used: boolean;
};

export type PreKeyBundle = {
  identityKey: string;
  signedPreKey: {
    id: number;
    publicKey: string;
    signature: string;
  };
  oneTimePreKey?: {
    id: number;
    publicKey: string;
  };
};

export type EncryptedEnvelope = {
  header: {
    topic: string;
    sender: string;
    timestamp: number;
  };
  body: string;
};

export type RecoveryKit = {
  identity: Identity;
  preKeys: PreKey[];
  exportedAt: number;
  cipherParams: {
    salt: string;
    nonce: string;
    iterations: number;
  };
  ciphertext: string;
};

export type Logger = {
  debug: (message: string, ...meta: unknown[]) => void;
  info: (message: string, ...meta: unknown[]) => void;
  warn: (message: string, ...meta: unknown[]) => void;
  error: (message: string, ...meta: unknown[]) => void;
};

export type PaginationOptions = {
  limit?: number;
  before?: number;
};

export type SendMessageRequest = {
  conversationId: string;
  peerPublicKey: string;
  plaintext: Uint8Array;
  attachments?: Array<{ uri: string; mime: string; data: Uint8Array }>;
};
