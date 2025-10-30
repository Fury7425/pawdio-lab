import React from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { tokens } from './tokens';

const placeholder = '████████████\n████    ████\n██  ██  ██\n████    ████\n████████████';

type Props = {
  title: string;
  subtitle?: string;
  fingerprint?: string;
  style?: ViewStyle;
};

export const QRCard: React.FC<Props> = ({ title, subtitle, fingerprint, style }) => (
  <View style={[styles.container, style]}>
    <View style={styles.qrBox}>
      <Text style={styles.qrText}>{placeholder}</Text>
    </View>
    <Text style={styles.title}>{title}</Text>
    {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    {fingerprint ? <Text style={styles.fingerprint}>{fingerprint}</Text> : null}
  </View>
);

const styles = StyleSheet.create({
  container: {
    padding: 24,
    backgroundColor: tokens.color.bg.surface,
    borderRadius: tokens.radii.lg,
    alignItems: 'center',
    gap: 12,
  },
  qrBox: {
    padding: 16,
    borderRadius: tokens.radii.md,
    backgroundColor: tokens.color.bg.page,
  },
  qrText: {
    color: tokens.color.text.primary,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
  title: {
    fontSize: tokens.font.size.title,
    color: tokens.color.text.primary,
    fontWeight: '600',
  },
  subtitle: {
    fontSize: tokens.font.size.body,
    color: tokens.color.text.secondary,
    textAlign: 'center',
  },
  fingerprint: {
    marginTop: 8,
    fontSize: tokens.font.size.caption,
    color: tokens.color.text.secondary,
    textAlign: 'center',
  },
});
