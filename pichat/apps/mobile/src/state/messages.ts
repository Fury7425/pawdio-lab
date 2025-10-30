import create from 'zustand';
import type { Message } from '@pichat/types';

export type MessagesState = {
  byConversation: Record<string, Message[]>;
  addMessage: (message: Message) => void;
  setMessages: (conversationId: string, messages: Message[]) => void;
};

export const useMessagesStore = create<MessagesState>((set) => ({
  byConversation: {},
  addMessage: (message) =>
    set((state) => {
      const list = state.byConversation[message.conversationId] ?? [];
      return {
        byConversation: {
          ...state.byConversation,
          [message.conversationId]: [...list, message].sort((a, b) => a.sentAt - b.sentAt),
        },
      };
    }),
  setMessages: (conversationId, messages) =>
    set((state) => ({
      byConversation: {
        ...state.byConversation,
        [conversationId]: messages,
      },
    })),
}));
