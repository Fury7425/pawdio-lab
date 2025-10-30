import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { tokens } from './tokens';

export type BubbleVariant = 'me' | 'peer' | 'system';

type Props = {
  variant?: BubbleVariant;
  message: string;
  timestamp?: string;
  status?: 'sent' | 'delivered' | 'read' | 'failed';
};

const statusIcon: Record<NonNullable<Props['status']>, string> = {
  sent: '✓',
  delivered: '✓✓',
  read: '✓✓',
  failed: '⚠️',
};

export const ChatBubble: React.FC<Props> = ({ variant = 'peer', message, timestamp, status }) => {
  const isMe = variant === 'me';
  const isSystem = variant === 'system';
  const backgroundColor = isSystem
    ? 'transparent'
    : isMe
    ? tokens.color.brand.primary
    : tokens.color.bg.surface;
  const textColor = isMe ? tokens.color.text.inverse : tokens.color.text.primary;
  return (
    <View
      style={[
        styles.container,
        isMe ? styles.alignEnd : styles.alignStart,
      ]}
    >
      <View
        style={[
          styles.bubble,
          {
            backgroundColor,
            borderTopLeftRadius: isMe ? tokens.radii.lg : tokens.radii.sm,
            borderTopRightRadius: isMe ? tokens.radii.sm : tokens.radii.lg,
          },
        ]}
      >
        <Text style={[styles.message, { color: textColor }]}>{message}</Text>
        <View style={styles.metaRow}>
          {timestamp ? <Text style={[styles.meta, { color: textColor }]}>{timestamp}</Text> : null}
          {status ? (
            <Text style={[styles.meta, { color: textColor }]}>{statusIcon[status]}</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: 4,
    flexDirection: 'row',
  },
  alignEnd: {
    justifyContent: 'flex-end',
  },
  alignStart: {
    justifyContent: 'flex-start',
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: tokens.radii.lg,
  },
  message: {
    fontSize: tokens.font.size.body,
    color: tokens.color.text.primary,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 4,
    gap: 6,
  },
  meta: {
    fontSize: tokens.font.size.micro,
    color: tokens.color.text.secondary,
  },
});
