import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text } from 'react-native';
import { tokens } from '../theme/tokens';

const DebugScreen = () => (
  <SafeAreaView style={styles.container}>
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Debug Tools</Text>
      <Text style={styles.body}>
        • Session health indicators
        {'\n'}• Last Waku peer
        {'\n'}• Pending pre-key rotations
        {'\n'}• Realm database path
      </Text>
    </ScrollView>
  </SafeAreaView>
);

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
    lineHeight: 20,
  },
});

export default DebugScreen;
