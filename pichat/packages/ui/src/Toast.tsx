import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, ViewStyle } from 'react-native';
import { tokens, Tone } from './tokens';

type Props = {
  message: string;
  tone?: Tone;
  visible: boolean;
  style?: ViewStyle;
};

const toneColor: Record<Tone, string> = {
  default: tokens.color.bg.surface,
  success: tokens.color.accent.success,
  warning: tokens.color.accent.warning,
  error: tokens.color.accent.error,
};

export const Toast: React.FC<Props> = ({ message, tone = 'default', visible, style }) => {
  const translateY = useRef(new Animated.Value(-80)).current;

  useEffect(() => {
    Animated.timing(translateY, {
      toValue: visible ? 0 : -80,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [translateY, visible]);

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      style={[
        styles.container,
        {
          backgroundColor: toneColor[tone],
          transform: [{ translateY }],
        },
        style,
      ]}
    >
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 20,
    left: 16,
    right: 16,
    borderRadius: tokens.radii.md,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  text: {
    color: tokens.color.text.primary,
    fontSize: tokens.font.size.body,
    textAlign: 'center',
  },
});
