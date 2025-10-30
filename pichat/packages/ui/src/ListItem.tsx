import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { tokens } from './tokens';
import { Avatar } from './Avatar';

type Props = {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  variant?: 'default' | 'navigable' | 'destructive';
  style?: ViewStyle;
  avatarLabel?: string;
};

export const ListItem: React.FC<Props> = ({
  title,
  subtitle,
  onPress,
  leading,
  trailing,
  variant = 'default',
  style,
  avatarLabel,
}) => {
  const content = (
    <View style={[styles.container, style]}>
      {leading
        ? leading
        : avatarLabel
        ? (
            <Avatar label={avatarLabel} size={44} />
          )
        : null}
      <View style={styles.textContainer}>
        <Text style={[styles.title, variant === 'destructive' && styles.destructive]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </View>
  );

  if (!onPress) {
    return content;
  }

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.8} accessibilityRole="button">
      {content}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
    gap: 12,
  },
  textContainer: {
    flex: 1,
  },
  title: {
    color: tokens.color.text.primary,
    fontSize: tokens.font.size.body,
    fontWeight: '600',
  },
  subtitle: {
    marginTop: 4,
    color: tokens.color.text.secondary,
    fontSize: tokens.font.size.caption,
  },
  destructive: {
    color: tokens.color.accent.error,
  },
});
