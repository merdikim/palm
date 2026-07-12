import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ClusterProvider } from '../context/ClusterContext';
import { WalletProvider } from '../context/WalletContext';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 10_000, refetchOnWindowFocus: false },
  },
});

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <ClusterProvider>
          <WalletProvider>{children}</WalletProvider>
        </ClusterProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
