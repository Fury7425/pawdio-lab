import React from 'react';
import { ActivityIndicator, SafeAreaView, StatusBar, StyleSheet, Text, View } from 'react-native';
import AppNavigator from './navigation';
import { useSession } from './hooks/useSession';
import { useWakuNode } from './hooks/useWakuNode';
import { tokens } from './theme/tokens';

const App = () => {
  const { identity, loading } = useSession();
  const { ready } = useWakuNode();

  if (loading || !ready || !identity) {
    return (
      <SafeAreaView style={styles.loadingContainer}>
        <StatusBar barStyle="light-content" />
        <ActivityIndicator size="large" color={tokens.color.brand.primary} />
        <Text style={styles.loadingText}>Preparing secure environment…</Text>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <AppNavigator />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: tokens.color.bg.page,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: tokens.color.bg.page,
  },
  loadingText: {
    marginTop: 12,
    color: tokens.color.text.secondary,
  },
});

export default App;
