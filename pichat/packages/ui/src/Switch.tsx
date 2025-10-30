import React from 'react';
import { Switch as RNSwitch, View, Text, StyleSheet } from 'react-native';
import { tokens } from './tokens';

type Props = {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
};

export const Switch: React.FC<Props> = ({ label, value, onValueChange }) => (
  <View style={styles.container}>
    <Text style={styles.label}>{label}</Text>
    <RNSwitch
      value={value}
      onValueChange={onValueChange}
      thumbColor={value ? tokens.color.brand.primary : tokens.color.border.muted}
      trackColor={{ false: tokens.color.border.muted, true: tokens.color.brand.primary }}
    />
  </View>
);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  label: {
    color: tokens.color.text.primary,
    fontSize: tokens.font.size.body,
  },
});
