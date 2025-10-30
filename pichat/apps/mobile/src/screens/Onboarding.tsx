import React from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { Button } from '../components/Button';
import { QRCard } from '../components/QRCard';
import type { RootStackParamList } from '../navigation';
import { useSession } from '../hooks/useSession';
import { tokens } from '../theme/tokens';

const OnboardingScreen = () => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { identity } = useSession();

  const handleContinue = () => {
    navigation.replace('Home');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Welcome to PiChat</Text>
        <Text style={styles.body}>
          Secure your communications with decentralized, end-to-end encrypted messaging.
        </Text>
        <QRCard
          title="Your Fingerprint"
          subtitle="Verify this with your contacts to ensure authenticity"
          fingerprint={identity?.fingerprint ?? '••••'}
        />
        <Button title="Enter PiChat" onPress={handleContinue} style={styles.button} />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.color.bg.page,
  },
  content: {
    flex: 1,
    padding: 24,
    gap: 24,
    justifyContent: 'center',
  },
  title: {
    color: tokens.color.text.primary,
    fontSize: 28,
    fontWeight: '700',
  },
  body: {
    color: tokens.color.text.secondary,
    fontSize: tokens.font.size.body,
  },
  button: {
    marginTop: 16,
  },
});

export default OnboardingScreen;
