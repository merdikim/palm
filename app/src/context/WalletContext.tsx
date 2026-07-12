import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { MobileWalletProvider, useMobileWallet } from '@wallet-ui/react-native-web3js';
import nacl from 'tweetnacl';
import type { AppIdentity, Chain } from '@solana-mobile/mobile-wallet-adapter-protocol';
import { SOLANA_RPC } from '../lib/constants';
import { APP_NAME } from '../constants/app-config';
import type { Signer } from '../lib/signer';
import { getTeeToken, clearSession, peekSession } from '../lib/session';
import { getApiToken, clearApiSession } from '../lib/apiSession';
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

const MWA_CHAIN: Chain = 'solana:mainnet';
const MWA_IDENTITY: AppIdentity = {
  name: APP_NAME,
  uri: 'https://usepalm.io',
  icon: 'favicon.ico',
};

export function WalletProvider({ children }: { children: React.ReactNode }) {
  return (
    <MobileWalletProvider chain={MWA_CHAIN} endpoint={SOLANA_RPC} identity={MWA_IDENTITY}>
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
        // MWA sign_messages returns `message || signature(64)` (spec: the
        // signature is APPENDED). Extract by known message length rather than a
        // blind last-64 slice, so extra/multiple appended bytes can't shift us.
        const signed = await mw.signMessages(message);
        const sig =
          signed.length >= message.length + 64
            ? signed.slice(message.length, message.length + 64)
            : signed.slice(signed.length - 64);

        // Self-verify against THIS account's key over the exact bytes the server
        // will re-verify. Turns an opaque server 403 into a precise local error:
        // a false here means the wallet signed different bytes (offchain-message
        // wrapping) or with a different account than `account.publicKey`.
        const ok = nacl.sign.detached.verify(
          message,
          sig,
          account.publicKey.toBytes(),
        );
        if (!ok) {
          throw new Error(
            `signMessage: local verification failed (payload ${signed.length}B, ` +
              `msg ${message.length}B, signer ${account.publicKey.toBase58()}). ` +
              'The wallet signed different bytes than the raw challenge (offchain ' +
              'wrapping) or with a different account.',
          );
        }
        return sig;
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
    // Establish BOTH sessions the app needs: the TEE JWT (private ER reads/
    // submits) and the Payments-API token (hosted /v1/spl/* bearer). Each is a
    // separate challenge/login against its own issuer.
    await Promise.all([getTeeToken(signer), getApiToken(signer)]);
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
    await clearApiSession();
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
