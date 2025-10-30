import React, { useState } from 'react';
import { Buffer } from 'buffer';
import { SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from '../components/Button';
import { exportRecovery, importRecovery } from '../services/recoveryService';
import { tokens } from '../theme/tokens';

const RecoveryScreen = () => {
  const [passphrase, setPassphrase] = useState('');
  const [exported, setExported] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const handleExport = async () => {
    const data = await exportRecovery(passphrase);
    setExported(Buffer.from(data).toString('base64'));
    setStatus('Recovery kit exported. Store it securely.');
  };

  const handleImport = async () => {
    if (!exported) return;
    await importRecovery(Buffer.from(exported, 'base64'), passphrase);
    setStatus('Recovery kit imported.');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Recovery Kit</Text>
        <Text style={styles.body}>
          Export your encrypted recovery kit to back up your identity keys. Keep the passphrase safe.
        </Text>
        <TextInput
          style={styles.input}
          placeholder="Passphrase"
          placeholderTextColor={tokens.color.text.secondary}
          secureTextEntry
          value={passphrase}
          onChangeText={setPassphrase}
        />
        <Button title="Export" onPress={handleExport} />
        <Button title="Import" variant="secondary" onPress={handleImport} />
        {exported ? (
          <View style={styles.exportBox}>
            <Text selectable style={styles.exported}>
              {exported}
            </Text>
          </View>
        ) : null}
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.color.bg.page,
  },
  content: {
    padding: 24,
    gap: 16,
  },
  title: {
    color: tokens.color.text.primary,
    fontSize: tokens.font.size.title,
    fontWeight: '700',
  },
  body: {
    color: tokens.color.text.secondary,
  },
  input: {
    borderWidth: 1,
    borderColor: tokens.color.border.muted,
    borderRadius: tokens.radii.md,
    padding: 16,
    color: tokens.color.text.primary,
  },
  exportBox: {
    backgroundColor: tokens.color.bg.surface,
    borderRadius: tokens.radii.md,
    padding: 16,
  },
  exported: {
    color: tokens.color.text.secondary,
    fontSize: tokens.font.size.micro,
  },
  status: {
    color: tokens.color.accent.success,
  },
});

export default RecoveryScreen;
