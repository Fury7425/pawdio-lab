import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { tokens } from './tokens';

type Props = {
  title: string;
  onBack?: () => void;
  actions?: React.ReactNode;
  transparent?: boolean;
};

export const AppBar: React.FC<Props> = ({ title, onBack, actions, transparent = false }) => (
  <View
    style={[
      styles.container,
      {
        backgroundColor: transparent ? 'transparent' : tokens.color.bg.surface,
      },
    ]}
  >
    {onBack ? (
      <TouchableOpacity accessibilityRole="button" onPress={onBack} style={styles.action}>
        <Text style={styles.actionLabel}>‹</Text>
      </TouchableOpacity>
    ) : (
      <View style={styles.actionPlaceholder} />
    )}
    <Text style={styles.title} numberOfLines={1}>
      {title}
    </Text>
    <View style={styles.actions}>{actions}</View>
  </View>
);

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    color: tokens.color.text.primary,
    fontSize: tokens.font.size.title,
    fontWeight: '600',
  },
  action: {
    padding: 8,
  },
  actionLabel: {
    color: tokens.color.text.primary,
    fontSize: 24,
  },
  actionPlaceholder: {
    width: 32,
  },
  actions: {
    minWidth: 32,
    alignItems: 'flex-end',
  },
});
