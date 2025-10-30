import Realm from 'realm';
import type {
  Identity,
  Contact,
  Conversation,
  Message,
  Attachment,
  PreKey,
  PaginationOptions,
} from '@pichat/types';
import { Schemas } from './schemas';

const config: Realm.Configuration = {
  schema: Schemas,
  schemaVersion: 1,
};

let realmInstance: Promise<Realm> | null = null;

const mapObject = <T>(object: (Realm.Object & T) | null): T | null => {
  if (!object) {
    return null;
  }
  return JSON.parse(JSON.stringify(object)) as T;
};

const mapCollection = <T>(collection: Realm.Results<Realm.Object & T>): T[] => {
  const list: T[] = [];
  for (let i = 0; i < collection.length; i += 1) {
    list.push(JSON.parse(JSON.stringify(collection[i])) as T);
  }
  return list;
};

export const getRealm = async (): Promise<Realm> => {
  if (!realmInstance) {
    realmInstance = Realm.open(config);
  }
  return realmInstance;
};

export const identityRepository = {
  async get(): Promise<Identity | null> {
    const realm = await getRealm();
    return mapObject<Identity>(realm.objects<Identity>('Identity')[0] ?? null);
  },
  async upsert(identity: Identity): Promise<void> {
    const realm = await getRealm();
    realm.write(() => {
      realm.create('Identity', identity, Realm.UpdateMode.Modified);
    });
  },
};

export const contactRepository = {
  async all(): Promise<Contact[]> {
    const realm = await getRealm();
    return mapCollection<Contact>(realm.objects<Contact>('Contact'));
  },
  async upsert(contact: Contact): Promise<void> {
    const realm = await getRealm();
    realm.write(() => {
      realm.create('Contact', contact, Realm.UpdateMode.Modified);
    });
  },
};

export const conversationRepository = {
  async list(): Promise<Conversation[]> {
    const realm = await getRealm();
    const results = realm.objects<Conversation>('Conversation').sorted('lastMessageAt', true);
    return mapCollection(results);
  },
  async upsert(conversation: Conversation): Promise<void> {
    const realm = await getRealm();
    realm.write(() => {
      realm.create('Conversation', conversation, Realm.UpdateMode.Modified);
    });
  },
  async incrementUnread(id: string): Promise<void> {
    const realm = await getRealm();
    const record = realm.objectForPrimaryKey<Conversation>('Conversation', id);
    if (!record) {
      return;
    }
    realm.write(() => {
      record.unreadCount += 1;
    });
  },
  async resetUnread(id: string): Promise<void> {
    const realm = await getRealm();
    const record = realm.objectForPrimaryKey<Conversation>('Conversation', id);
    if (!record) {
      return;
    }
    realm.write(() => {
      record.unreadCount = 0;
    });
  },
};

export const messageRepository = {
  async add(message: Message): Promise<void> {
    const realm = await getRealm();
    realm.write(() => {
      realm.create('Message', message, Realm.UpdateMode.Modified);
    });
  },
  async list(conversationId: string, options: PaginationOptions = {}): Promise<Message[]> {
    const realm = await getRealm();
    let query = realm.objects<Message>('Message').filtered('conversationId == $0', conversationId);
    if (options.before) {
      query = query.filtered('sentAt < $0', options.before);
    }
    const sorted = query.sorted('sentAt', true);
    const results = options.limit ? sorted.slice(0, options.limit) : sorted;
    return mapCollection(results as Realm.Results<Realm.Object & Message>);
  },
};

export const attachmentRepository = {
  async add(attachment: Attachment): Promise<void> {
    const realm = await getRealm();
    realm.write(() => {
      realm.create('Attachment', attachment, Realm.UpdateMode.Modified);
    });
  },
  async byMessage(messageId: string): Promise<Attachment[]> {
    const realm = await getRealm();
    return mapCollection(
      realm.objects<Attachment>('Attachment').filtered('messageId == $0', messageId),
    );
  },
};

export const preKeyRepository = {
  async all(): Promise<PreKey[]> {
    const realm = await getRealm();
    return mapCollection(realm.objects<PreKey>('PreKey'));
  },
  async upsert(preKey: PreKey): Promise<void> {
    const realm = await getRealm();
    realm.write(() => {
      realm.create('PreKey', preKey, Realm.UpdateMode.Modified);
    });
  },
};
