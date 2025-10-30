import create from 'zustand';
import type { Conversation } from '@pichat/types';

export type ConversationsState = {
  conversations: Conversation[];
  upsert: (conversation: Conversation) => void;
  incrementUnread: (id: string) => void;
  resetUnread: (id: string) => void;
};

export const useConversationsStore = create<ConversationsState>((set) => ({
  conversations: [],
  upsert: (conversation) =>
    set((state) => {
      const existing = state.conversations.find((item) => item.id === conversation.id);
      if (existing) {
        return {
          conversations: state.conversations.map((item) =>
            item.id === conversation.id ? { ...item, ...conversation } : item,
          ),
        };
      }
      return { conversations: [...state.conversations, conversation] };
    }),
  incrementUnread: (id) =>
    set((state) => ({
      conversations: state.conversations.map((item) =>
        item.id === id ? { ...item, unreadCount: item.unreadCount + 1 } : item,
      ),
    })),
  resetUnread: (id) =>
    set((state) => ({
      conversations: state.conversations.map((item) =>
        item.id === id ? { ...item, unreadCount: 0 } : item,
      ),
    })),
}));
