import React from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { tokens } from './tokens';
import { Button } from './Button';

type Props = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
};

export const Dialog: React.FC<Props> = ({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}) => (
  <Modal transparent visible={visible} animationType="fade" onRequestClose={onCancel}>
    <View style={styles.backdrop}>
      <View style={styles.container}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        <View style={styles.actions}>
          {onCancel ? <Button variant="ghost" title={cancelLabel} onPress={onCancel} /> : null}
          <Button title={confirmLabel} onPress={onConfirm ?? (() => undefined)} />
        </View>
      </View>
    </View>
  </Modal>
);

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  container: {
    backgroundColor: tokens.color.bg.surface,
    padding: 24,
    borderRadius: tokens.radii.lg,
    width: '100%',
  },
  title: {
    fontSize: tokens.font.size.title,
    color: tokens.color.text.primary,
    fontWeight: '700',
  },
  message: {
    marginTop: 12,
    color: tokens.color.text.secondary,
    fontSize: tokens.font.size.body,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 24,
    gap: 12,
  },
});
