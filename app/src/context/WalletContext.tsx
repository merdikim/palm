import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { MobileWalletProvider, useMobileWallet } from '@wallet-ui/react-native-web3js';
import type { AppIdentity, Chain } from '@solana-mobile/mobile-wallet-adapter-protocol';
import { SOLANA_DEVNET_RPC } from '../lib/constants';
import type { Signer } from '../lib/signer';
import { getTeeToken, clearSession, peekSession } from '../lib/session';
import {
  getOnboardingStep,
  setOnboardingStep,
  resetOnboarding,
  type OnboardingStep,
} from '../lib/onboarding';

interface WalletState {
  ready: boolean;
  signer: Signer | null;
  publicKey: string | null;
  step: OnboardingStep;
  authed: boolean;
  connectWallet: () => Promise<void>;
  authenticate: () => Promise<void>;
  advanceStep: (step: OnboardingStep) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<WalletState | null>(null);

const MWA_CHAIN: Chain = 'solana:devnet';
const MWA_IDENTITY: AppIdentity = {
  name: 'Palm',
  uri: 'https://usepalm.io',
  icon: 'favicon.ico',
};

export function WalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <MobileWalletProvider chain={MWA_CHAIN} endpoint={SOLANA_DEVNET_RPC} identity={MWA_IDENTITY}>
      <WalletBridge>{children}</WalletBridge>
    </MobileWalletProvider>
  );
}

function WalletBridge({ children }: { children: React.ReactNode }) {
  const mw = useMobileWallet();
  const account = mw.account;
  const { store, connect: mwConnect, disconnect: mwDisconnect } = mw;

  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [authed, setAuthed] = useState(false);

  const signer = useMemo<Signer | null>(() => {
    if (!account) return null;
    return {
      publicKey: account.publicKey,
      async signMessage(message: Uint8Array): Promise<Uint8Array> {
        const signed = await mw.signMessages(message);
        return signed.length > 64 ? signed.slice(signed.length - 64) : signed;
      },
      async signTransaction(tx) {
        return mw.signTransaction(tx);
      },
    };
  }, [account, mw.signMessages, mw.signTransaction]);

  const publicKey = account?.publicKey.toBase58() ?? null;

  useEffect(() => {
    let alive = true;
    (async () => {
      await store.fetch().catch(() => {});
      const s = await getOnboardingStep();
      if (!alive) return;
      setStep(s);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [store]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const sess = await peekSession();
      if (!alive) return;
      setAuthed(!!sess && !!publicKey && sess.pubkey === publicKey);
    })();
    return () => {
      alive = false;
    };
  }, [publicKey]);

  const connectWallet = useCallback(async () => {
    await mwConnect();
    await setOnboardingStep('key_ready');
    setStep('key_ready');
  }, [mwConnect]);

  const authenticate = useCallback(async () => {
    if (!signer) throw new Error('No wallet');
    await getTeeToken(signer);
    setAuthed(true);
    await setOnboardingStep('authed');
    setStep('authed');
  }, [signer]);

  const advanceStep = useCallback(async (next: OnboardingStep) => {
    await setOnboardingStep(next);
    setStep(next);
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    await resetOnboarding();
    await mwDisconnect().catch(() => {});
    setAuthed(false);
    setStep('welcome');
  }, [mwDisconnect]);

  const value = useMemo<WalletState>(
    () => ({
      ready,
      signer,
      publicKey,
      step,
      authed,
      connectWallet,
      authenticate,
      advanceStep,
      signOut,
    }),
    [
      ready,
      signer,
      publicKey,
      step,
      authed,
      connectWallet,
      authenticate,
      advanceStep,
      signOut,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): WalletState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWallet must be used within WalletProvider');
  return v;
}
