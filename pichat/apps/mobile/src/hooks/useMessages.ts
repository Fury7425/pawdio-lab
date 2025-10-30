import { useEffect } from 'react';
import { useMessagesStore } from '../state/messages';
import { messageRepository } from '@pichat/storage';

export const useMessages = (conversationId: string) => {
  const messages = useMessagesStore((state) => state.byConversation[conversationId] ?? []);
  const setMessages = useMessagesStore((state) => state.setMessages);

  useEffect(() => {
    const load = async () => {
      const history = await messageRepository.list(conversationId, { limit: 100 });
      setMessages(conversationId, history.reverse());
    };
    load();
  }, [conversationId, setMessages]);

  return messages;
};
