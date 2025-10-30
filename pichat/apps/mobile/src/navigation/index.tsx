import React from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import OnboardingScreen from '../screens/Onboarding';
import HomeScreen from '../screens/Home';
import ChatScreen from '../screens/Chat';
import AddContactScreen from '../screens/AddContact';
import SettingsScreen from '../screens/Settings';
import RecoveryScreen from '../screens/Recovery';
import DebugScreen from '../screens/Debug';

export type RootStackParamList = {
  Onboarding: undefined;
  Home: undefined;
  Chat: { conversationId: string; peerPublicKey: string };
  AddContact: undefined;
  Settings: undefined;
  Recovery: undefined;
  Debug: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const AppNavigator = () => (
  <NavigationContainer theme={DarkTheme}>
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Onboarding" component={OnboardingScreen} />
      <Stack.Screen name="Home" component={HomeScreen} />
      <Stack.Screen name="Chat" component={ChatScreen} />
      <Stack.Screen name="AddContact" component={AddContactScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Recovery" component={RecoveryScreen} />
      <Stack.Screen name="Debug" component={DebugScreen} />
    </Stack.Navigator>
  </NavigationContainer>
);

export default AppNavigator;
