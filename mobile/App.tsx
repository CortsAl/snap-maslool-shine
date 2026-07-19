import 'react-native-gesture-handler';

import React from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { StatusBar } from 'expo-status-bar';

import { HomeScreen } from './src/screens/HomeScreen';
import { ProcessingScreen } from './src/screens/ProcessingScreen';
import { ResultScreen } from './src/screens/ResultScreen';
import type { RootStackParamList } from './src/types/navigation';

const Stack = createStackNavigator<RootStackParamList>();

const appTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#0f0f12',
    card: '#18181d',
    border: '#2f2f37',
    primary: '#f4c542',
    text: '#f7f0d8',
  },
};

export default function App() {
  return (
    // Wrap the screens in a React Navigation container for stack-based app flow.
    <NavigationContainer theme={appTheme}>
      <StatusBar style="light" />
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: { backgroundColor: '#18181d' },
          headerTintColor: '#f4c542',
          headerTitleStyle: { fontWeight: '700' },
          cardStyle: { backgroundColor: '#0f0f12' },
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Snap & Shine' }} />
        <Stack.Screen
          name="Processing"
          component={ProcessingScreen}
          options={{ title: 'Enhancing Photo' }}
        />
        <Stack.Screen name="Result" component={ResultScreen} options={{ title: 'Studio Result' }} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
