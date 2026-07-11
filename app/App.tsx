/**
 * App root — providers, font loading, and the onboarding gate.
 *
 * The signed-in experience is a single custom shell (HavenShell) with its own
 * header, tabs and bottom-sheets, so we no longer need a navigator here — the
 * gate simply chooses Onboarding vs HavenShell based on persisted wallet state.
 */
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
} from '@expo-google-fonts/instrument-sans';

import { WalletProvider, useWallet } from './src/context/WalletContext';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { HavenShell } from './src/screens/HavenShell';
import { haven } from './src/theme';

function Loader() {
  return (
    <View style={{ flex: 1, backgroundColor: haven.screen, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={haven.green} />
    </View>
  );
}

function Gate() {
  const w = useWallet();
  if (!w.ready) return <Loader />;
  const onboarded = w.step === 'done' && !!w.signer;
  return onboarded ? <HavenShell /> : <OnboardingScreen />;
}

export default function App() {
  const [fontsLoaded] = useFonts({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
  });

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {fontsLoaded ? (
        <WalletProvider>
          <Gate />
        </WalletProvider>
      ) : (
        <Loader />
      )}
    </SafeAreaProvider>
  );
}
