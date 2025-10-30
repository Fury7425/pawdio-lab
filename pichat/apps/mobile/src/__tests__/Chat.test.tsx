import React from 'react';
import { render } from '@testing-library/react-native';
import ChatScreen from '../screens/Chat';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';

jest.mock('../hooks/useMessages', () => ({
  useMessages: () => [
    {
      id: '1',
      conversationId: 'c1',
      senderId: 'me',
      kind: 'text',
      ciphertext: 'Hello',
      status: 'sent',
      sentAt: Date.now(),
    },
  ],
}));

jest.mock('../services/messageService', () => ({
  subscribeToConversation: jest.fn(async () => () => undefined),
  sendMessage: jest.fn(),
  formatMessage: (message: any) => ({ ...message, displayTime: 'now' }),
}));

const createProps = (): NativeStackScreenProps<RootStackParamList, 'Chat'> => ({
  navigation: {} as any,
  route: { params: { conversationId: 'c1', peerPublicKey: 'peer' }, key: 'Chat', name: 'Chat' },
});

describe('ChatScreen', () => {
  it('renders messages', () => {
    const { getByText } = render(<ChatScreen {...createProps()} />);
    expect(getByText('Hello')).toBeTruthy();
  });
});
