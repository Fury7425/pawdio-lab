import React, { useEffect, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, SafeAreaView, StyleSheet, TextInput, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ChatBubble } from '../components/ChatBubble';
import { Button } from '../components/Button';
import { useMessages } from '../hooks/useMessages';
import { subscribeToConversation, sendMessage, formatMessage } from '../services/messageService';
import type { RootStackParamList } from '../navigation';
import { tokens } from '../theme/tokens';

const ChatScreen = ({ route }: NativeStackScreenProps<RootStackParamList, 'Chat'>) => {
  const { conversationId, peerPublicKey } = route.params;
  const messages = useMessages(conversationId);
  const [input, setInput] = useState('');

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    subscribeToConversation(peerPublicKey, conversationId, () => undefined).then((off) => {
      unsubscribe = off;
    });
    return () => {
      unsubscribe?.();
    };
  }, [conversationId, peerPublicKey]);

  const handleSend = async () => {
    if (!input.trim()) return;
    await sendMessage(conversationId, peerPublicKey, input.trim());
    setInput('');
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={80}
      >
        <FlatList
          data={messages.map(formatMessage)}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <ChatBubble
              variant={item.senderId === peerPublicKey ? 'peer' : 'me'}
              message={item.kind === 'text' ? item.ciphertext : 'Unsupported'}
              timestamp={item.displayTime}
              status={item.status}
            />
          )}
        />
        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Type a secure message"
            placeholderTextColor={tokens.color.text.secondary}
            value={input}
            onChangeText={setInput}
          />
          <Button title="Send" onPress={handleSend} size="sm" />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.color.bg.page,
  },
  flex: {
    flex: 1,
  },
  list: {
    padding: 16,
    gap: 12,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    gap: 12,
  },
  input: {
    flex: 1,
    borderRadius: tokens.radii.md,
    borderWidth: 1,
    borderColor: tokens.color.border.muted,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: tokens.color.text.primary,
  },
});

export default ChatScreen;
