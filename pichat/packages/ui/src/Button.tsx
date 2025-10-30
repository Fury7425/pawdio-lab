import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, ViewStyle } from 'react-native';
import { tokens } from './tokens';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';
type ButtonSize = 'md' | 'sm';

type Props = {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
};

const sizeStyles: Record<ButtonSize, { paddingVertical: number; paddingHorizontal: number; fontSize: number }>
 = {
  md: { paddingVertical: 14, paddingHorizontal: 20, fontSize: tokens.font.size.body },
  sm: { paddingVertical: 10, paddingHorizontal: 16, fontSize: tokens.font.size.caption },
};

const variantStyles: Record<ButtonVariant, { backgroundColor: string; textColor: string; borderColor?: string }> = {
  primary: { backgroundColor: tokens.color.brand.primary, textColor: tokens.color.text.inverse },
  secondary: {
    backgroundColor: tokens.color.bg.surface,
    textColor: tokens.color.text.primary,
    borderColor: tokens.color.border.muted,
  },
  ghost: { backgroundColor: 'transparent', textColor: tokens.color.brand.primary, borderColor: 'transparent' },
};

export const Button: React.FC<Props> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  style,
}) => {
  const sizeStyle = sizeStyles[size];
  const variantStyle = variantStyles[variant];
  const opacity = disabled ? 0.5 : 1;

  return (
    <TouchableOpacity
      accessibilityRole="button"
      activeOpacity={0.8}
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.base,
        {
          backgroundColor: variantStyle.backgroundColor,
          paddingVertical: sizeStyle.paddingVertical,
          paddingHorizontal: sizeStyle.paddingHorizontal,
          borderColor: variantStyle.borderColor ?? variantStyle.backgroundColor,
          opacity,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variantStyle.textColor} />
      ) : (
        <Text style={[styles.label, { color: variantStyle.textColor, fontSize: sizeStyle.fontSize }]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  base: {
    borderRadius: tokens.radii.md,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: 44,
  },
  label: {
    fontFamily: tokens.font.family,
    fontWeight: '600',
  },
});
