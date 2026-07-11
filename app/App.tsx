/**
 * App root — providers, font loading, and the onboarding gate.
 *
 * The signed-in experience is a single custom shell (PalmShell) with its own
 * header, tabs and bottom-sheets, so we no longer need a navigator here — the
 * gate simply chooses Onboarding vs PalmShell based on persisted wallet state.
 */
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
} from '@expo-google-fonts/instrument-sans';

import { AppProviders } from './src/providers/AppProviders';
import { useWallet } from './src/context/WalletContext';
import { OnboardingScreen } from './src/screens/OnboardingScreen';
import { PalmShell } from './src/screens/PalmShell';
import { palm } from './src/theme';

function Loader() {
  return (
    <View style={{ flex: 1, backgroundColor: palm.screen, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={palm.green} />
    </View>
  );
}

function Gate() {
  const w = useWallet();
  if (!w.ready) return <Loader />;
  const onboarded = w.step === 'done' && !!w.signer;
  return onboarded ? <PalmShell /> : <OnboardingScreen />;
}

export default function App() {
  const [fontsLoaded] = useFonts({
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
  });

  return (
    <AppProviders>
      <StatusBar style="dark" />
      {fontsLoaded ? <Gate /> : <Loader />}
    </AppProviders>
  );
}
