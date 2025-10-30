import React from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { tokens } from './tokens';

type Props = TextInputProps & {
  label?: string;
  helperText?: string;
  error?: string;
  containerStyle?: ViewStyle;
};

export const Input: React.FC<Props> = ({
  label,
  helperText,
  error,
  containerStyle,
  style,
  ...props
}) => {
  const activeHelper = error ?? helperText;
  const helperColor = error ? tokens.color.accent.error : tokens.color.text.secondary;
  return (
    <View style={[styles.container, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={tokens.color.text.secondary}
        style={[styles.input, error && styles.inputError, style]}
        {...props}
      />
      {activeHelper ? <Text style={[styles.helper, { color: helperColor }]}>{activeHelper}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  label: {
    color: tokens.color.text.secondary,
    marginBottom: 4,
    fontSize: tokens.font.size.caption,
  },
  input: {
    borderWidth: 1,
    borderColor: tokens.color.border.muted,
    borderRadius: tokens.radii.md,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: tokens.font.size.body,
    color: tokens.color.text.primary,
    backgroundColor: tokens.color.bg.surface,
  },
  inputError: {
    borderColor: tokens.color.accent.error,
  },
  helper: {
    marginTop: 4,
    fontSize: tokens.font.size.micro,
  },
});
