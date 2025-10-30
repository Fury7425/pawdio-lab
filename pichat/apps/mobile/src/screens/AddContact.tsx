import React, { useMemo, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { Button } from '../components/Button';
import { QRCard } from '../components/QRCard';
import { useIdentityStore } from '../state/identity';
import type { RootStackParamList } from '../navigation';
import { tokens } from '../theme/tokens';
import { addContact, createContactUri, parseContactUri } from '../services/contactService';

const AddContactScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const identity = useIdentityStore((state) => state.identity);
  const [activeTab, setActiveTab] = useState<'share' | 'paste'>('share');
  const [linkInput, setLinkInput] = useState('');
  const [status, setStatus] = useState<string | null>(null);

  const myContactUri = useMemo(() => {
    if (!identity) return '';
    return createContactUri({
      displayName: identity.fingerprint,
      pubKey: identity.pubKey,
      bundle: {
        identityKey: identity.pubKey,
        signedPreKey: { id: 1, publicKey: identity.pubKey, signature: identity.privRef },
      },
    });
  }, [identity]);

  const handlePasteLink = async () => {
    try {
      const payload = parseContactUri(linkInput.trim());
      await addContact(payload);
      setStatus('Contact added!');
      navigation.navigate('Home');
    } catch (err) {
      setStatus('Invalid link');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.tabs}>
        <Button
          title="Share"
          variant={activeTab === 'share' ? 'primary' : 'secondary'}
          onPress={() => setActiveTab('share')}
        />
        <Button
          title="Paste Link"
          variant={activeTab === 'paste' ? 'primary' : 'secondary'}
          onPress={() => setActiveTab('paste')}
        />
      </View>
      {activeTab === 'share' ? (
        <View style={styles.tabContent}>
          <QRCard
            title="Share your code"
            subtitle="Friends can scan or paste this link"
            fingerprint={identity?.fingerprint}
          />
          <Text style={styles.link} selectable>
            {myContactUri}
          </Text>
        </View>
      ) : (
        <View style={styles.tabContent}>
          <TextInput
            style={styles.input}
            placeholder="Paste contact link"
            placeholderTextColor={tokens.color.text.secondary}
            value={linkInput}
            onChangeText={setLinkInput}
          />
          <Button title="Add Contact" onPress={handlePasteLink} />
          {status ? <Text style={styles.status}>{status}</Text> : null}
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.color.bg.page,
    padding: 24,
    gap: 24,
  },
  tabs: {
    flexDirection: 'row',
    gap: 12,
  },
  tabContent: {
    gap: 16,
  },
  link: {
    color: tokens.color.brand.primary,
  },
  input: {
    borderWidth: 1,
    borderColor: tokens.color.border.muted,
    borderRadius: tokens.radii.md,
    padding: 16,
    color: tokens.color.text.primary,
  },
  status: {
    color: tokens.color.text.secondary,
  },
});

export default AddContactScreen;
