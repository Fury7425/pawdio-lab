import React, { useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Switch } from '../components/Switch';
import { Button } from '../components/Button';
import type { RootStackParamList } from '../navigation';
import { tokens } from '../theme/tokens';

const SettingsScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [biometric, setBiometric] = useState(true);
  const [inactivityLock, setInactivityLock] = useState(true);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.header}>Privacy</Text>
        <View style={styles.card}>
          <Switch label="Require biometric unlock" value={biometric} onValueChange={setBiometric} />
          <Switch
            label="Lock on inactivity"
            value={inactivityLock}
            onValueChange={setInactivityLock}
          />
        </View>
        <Text style={styles.header}>Recovery</Text>
        <View style={styles.card}>
          <Button title="Export Recovery Kit" onPress={() => navigation.navigate('Recovery')} />
          <Button title="Import Recovery Kit" variant="secondary" onPress={() => navigation.navigate('Recovery')} />
        </View>
        <Text style={styles.header}>Advanced</Text>
        <View style={styles.card}>
          <Button title="Debug" variant="ghost" onPress={() => navigation.navigate('Debug')} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.color.bg.page,
  },
  content: {
    padding: 24,
    gap: 16,
  },
  header: {
    color: tokens.color.text.secondary,
    fontSize: tokens.font.size.caption,
  },
  card: {
    backgroundColor: tokens.color.bg.surface,
    padding: 16,
    borderRadius: tokens.radii.lg,
    gap: 12,
  },
});

export default SettingsScreen;
