import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { tokens } from './tokens';

type Props = {
  uri?: string;
  size?: number;
  label: string;
};

const generateColor = (label: string) => {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = label.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 50%, 40%)`;
};

export const Avatar: React.FC<Props> = ({ uri, size = 40, label }) => {
  const initials = label
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const backgroundColor = generateColor(label);
  return uri ? (
    <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />
  ) : (
    <View
      style={[
        styles.fallback,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor,
        },
      ]}
    >
      <Text style={styles.initials}>{initials}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  fallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    color: tokens.color.text.inverse,
    fontWeight: '600',
  },
});
