/**
 * App root — providers, navigation (bottom tabs + per-tab stacks), onboarding
 * gate, and push-notification deep-link wiring.
 */
import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer, type NavigationContainerRef } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';

import { WalletProvider, useWallet } from './src/context/WalletContext';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { AgentsListScreen } from './src/screens/AgentsListScreen';
import { CreateVaultScreen } from './src/screens/CreateVaultScreen';
import { AgentDetailScreen } from './src/screens/AgentDetailScreen';
import { RequestsScreen } from './src/screens/RequestsScreen';
import { theme } from './src/theme';
import { linking } from './src/navigation/types';
import type {
  AgentsStackParamList,
  HomeStackParamList,
  RequestsStackParamList,
  TabParamList,
  RootParamList,
} from './src/navigation/types';

const Tabs = createBottomTabNavigator<TabParamList>();
const HomeStack = createNativeStackNavigator<HomeStackParamList>();
const AgentsStack = createNativeStackNavigator<AgentsStackParamList>();
const RequestsStack = createNativeStackNavigator<RequestsStackParamList>();
const RootStack = createNativeStackNavigator<RootParamList>();

const navTheme = {
  dark: true,
  colors: {
    primary: theme.colors.primary,
    background: theme.colors.bg,
    card: theme.colors.surface,
    text: theme.colors.text,
    border: theme.colors.border,
    notification: theme.colors.primary,
  },
  fonts: {
    regular: { fontFamily: 'System', fontWeight: '400' as const },
    medium: { fontFamily: 'System', fontWeight: '500' as const },
    bold: { fontFamily: 'System', fontWeight: '700' as const },
    heavy: { fontFamily: 'System', fontWeight: '800' as const },
  },
};

const screenOptions = {
  headerStyle: { backgroundColor: theme.colors.surface },
  headerTintColor: theme.colors.text,
  contentStyle: { backgroundColor: theme.colors.bg },
} as const;

function HomeStackNav() {
  return (
    <HomeStack.Navigator screenOptions={screenOptions}>
      <HomeStack.Screen name="HomeMain" component={HomeScreen} options={{ title: 'Palm' }} />
    </HomeStack.Navigator>
  );
}

function AgentsStackNav() {
  return (
    <AgentsStack.Navigator screenOptions={screenOptions}>
      <AgentsStack.Screen name="AgentsList" component={AgentsListScreen} options={{ title: 'Agents' }} />
      <AgentsStack.Screen name="CreateVault" component={CreateVaultScreen} options={{ title: 'New vault' }} />
      <AgentsStack.Screen name="AgentDetail" component={AgentDetailScreen} options={{ title: 'Agent' }} />
    </AgentsStack.Navigator>
  );
}

function RequestsStackNav() {
  return (
    <RequestsStack.Navigator screenOptions={screenOptions}>
      <RequestsStack.Screen name="RequestsList" component={RequestsScreen} options={{ title: 'Requests' }} />
    </RequestsStack.Navigator>
  );
}

function MainTabs() {
  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: theme.colors.surface, borderTopColor: theme.colors.border },
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textDim,
      }}
    >
      <Tabs.Screen name="Home" component={HomeStackNav} />
      <Tabs.Screen name="Agents" component={AgentsStackNav} />
      <Tabs.Screen name="Requests" component={RequestsStackNav} />
    </Tabs.Navigator>
  );
}

function Gate() {
  const w = useWallet();
  const navRef = useRef<NavigationContainerRef<RootParamList>>(null);

  // Deep-link push taps to the Requests tab, carrying the opaque id.
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const data = resp.notification.request.content.data as { id?: string };
      const id = data?.id;
      navRef.current?.navigate('Tabs', {
        screen: 'Requests',
        params: { screen: 'RequestsList', params: { focusId: id } },
      });
    });
    return () => sub.remove();
  }, []);

  if (!w.ready) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  const onboarded = w.step === 'done' && !!w.signer;

  return (
    <NavigationContainer ref={navRef} theme={navTheme} linking={linking}>
      <StatusBar style="light" />
      <RootStack.Navigator screenOptions={{ headerShown: false }}>
        {onboarded ? (
          <RootStack.Screen name="Tabs" component={MainTabs} />
        ) : (
          <RootStack.Screen name="Onboarding" component={OnboardingScreen} />
        )}
      </RootStack.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <WalletProvider>
      <Gate />
    </WalletProvider>
  );
}
