import React, { useEffect, useState } from 'react';
import { FlatList, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { conversationRepository, contactRepository } from '@pichat/storage';
import type { Contact, Conversation } from '@pichat/types';
import { useConversationsStore } from '../state/conversations';
import { ConversationItem } from '../components/ConversationItem';
import { Button } from '../components/Button';
import type { RootStackParamList } from '../navigation';
import { tokens } from '../theme/tokens';

const HomeScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const conversations = useConversationsStore((state) => state.conversations);
  const upsert = useConversationsStore((state) => state.upsert);
  const [contacts, setContacts] = useState<Record<string, Contact>>({});

  useEffect(() => {
    const load = async () => {
      const [items, contactsList] = await Promise.all([
        conversationRepository.list(),
        contactRepository.all(),
      ]);
      items.forEach((item) => upsert(item));
      setContacts(
        contactsList.reduce((acc, contact) => ({ ...acc, [contact.id]: contact }), {} as Record<string, Contact>),
      );
    };
    load();
  }, [upsert]);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Conversations</Text>
        <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
          <Text style={styles.settings}>Settings</Text>
        </TouchableOpacity>
      </View>
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <ConversationItem
            conversation={item}
            contact={contacts[item.peerId]}
            onPress={() => navigation.navigate('Chat', { conversationId: item.id, peerPublicKey: item.peerId })}
          />
        )}
        ListEmptyComponent={<Text style={styles.empty}>No conversations yet. Add a contact.</Text>}
      />
      <Button title="New Chat" onPress={() => navigation.navigate('AddContact')} style={styles.fab} />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.color.bg.page,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 24,
    alignItems: 'center',
  },
  title: {
    color: tokens.color.text.primary,
    fontSize: tokens.font.size.title,
    fontWeight: '700',
  },
  settings: {
    color: tokens.color.brand.primary,
    fontSize: tokens.font.size.body,
  },
  list: {
    paddingHorizontal: 16,
  },
  empty: {
    color: tokens.color.text.secondary,
    textAlign: 'center',
    marginTop: 32,
  },
  fab: {
    margin: 24,
  },
});

export default HomeScreen;
