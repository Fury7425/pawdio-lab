import React from 'react';
import type { Conversation, Contact } from '@pichat/types';
import { ListItem } from '@pichat/ui';
import { formatTime } from '../utils/time';

type Props = {
  conversation: Conversation;
  contact?: Contact;
  onPress: () => void;
};

export const ConversationItem: React.FC<Props> = ({ conversation, contact, onPress }) => (
  <ListItem
    title={contact?.displayName ?? conversation.peerId}
    subtitle={
      conversation.lastMessageAt
        ? `Last message • ${formatTime(conversation.lastMessageAt)}`
        : 'No messages yet'
    }
    avatarLabel={contact?.displayName ?? conversation.peerId}
    onPress={onPress}
    trailing={
      conversation.unreadCount > 0 ? (
        <ListItem
          title={`${conversation.unreadCount}`}
          style={{
            backgroundColor: '#7C5CFF33',
            borderRadius: 16,
            paddingHorizontal: 12,
            paddingVertical: 4,
          }}
        />
      ) : undefined
    }
  />
);
