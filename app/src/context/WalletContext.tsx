/**
 * WalletContext — owns the active Signer and TEE session lifecycle, and exposes
 * the private balance. Screens consume this instead of touching the signer or
 * session cache directly.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { LocalKeypairSigner, type Signer } from '../lib/signer';
import { getTeeToken, clearSession, peekSession } from '../lib/session';
import {
  getOnboardingStep,
  setOnboardingStep,
  resetOnboarding,
  type OnboardingStep,
} from '../lib/onboarding';

interface WalletState {
  ready: boolean; // initial load complete
  signer: Signer | null;
  publicKey: string | null;
  step: OnboardingStep;
  authed: boolean;
  // actions
  createWallet: () => Promise<void>;
  importWallet: (secretBase58: string) => Promise<void>;
  authenticate: () => Promise<void>;
  advanceStep: (step: OnboardingStep) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [step, setStep] = useState<OnboardingStep>('welcome');
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    (async () => {
      const existing = await LocalKeypairSigner.load();
      if (existing) setSigner(existing);
      const s = await getOnboardingStep();
      setStep(s);
      const sess = await peekSession();
      setAuthed(!!sess && sess.pubkey === existing?.publicKey.toBase58());
      setReady(true);
    })();
  }, []);

  const createWallet = useCallback(async () => {
    const s = await LocalKeypairSigner.create();
    setSigner(s);
    await setOnboardingStep('key_ready');
    setStep('key_ready');
  }, []);

  const importWallet = useCallback(async (secretBase58: string) => {
    const s = await LocalKeypairSigner.importFromBase58(secretBase58);
    setSigner(s);
    await setOnboardingStep('key_ready');
    setStep('key_ready');
  }, []);

  const authenticate = useCallback(async () => {
    if (!signer) throw new Error('No wallet');
    await getTeeToken(signer); // triggers TEE /auth + caches JWT
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
    await LocalKeypairSigner.wipe();
    setSigner(null);
    setAuthed(false);
    setStep('welcome');
  }, []);

  const value = useMemo<WalletState>(
    () => ({
      ready,
      signer,
      publicKey: signer?.publicKey.toBase58() ?? null,
      step,
      authed,
      createWallet,
      importWallet,
      authenticate,
      advanceStep,
      signOut,
    }),
    [
      ready,
      signer,
      step,
      authed,
      createWallet,
      importWallet,
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
