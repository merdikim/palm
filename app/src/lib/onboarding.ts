/**
 * onboarding.ts — persisted onboarding progress + memo hashing.
 *
 * Onboarding must survive the app being backgrounded/killed, so each completed
 * step is written to secure storage and the flow resumes from the saved step.
 */
import * as SecureStore from 'expo-secure-store';
import nacl from 'tweetnacl';

const ONBOARDING_STORE = 'palm.onboarding.step.v1';

export const ONBOARDING_STEPS = [
  'welcome', // choose create/import
  'key_ready', // keypair exists in secure-store
  'authed', // TEE token cached
  'funded', // optional first deposit done (or skipped)
  'done',
] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export async function getOnboardingStep(): Promise<OnboardingStep> {
  const raw = await SecureStore.getItemAsync(ONBOARDING_STORE);
  if (raw && (ONBOARDING_STEPS as readonly string[]).includes(raw)) {
    return raw as OnboardingStep;
  }
  return 'welcome';
}

export async function setOnboardingStep(step: OnboardingStep): Promise<void> {
  await SecureStore.setItemAsync(ONBOARDING_STORE, step);
}

export async function isOnboarded(): Promise<boolean> {
  return (await getOnboardingStep()) === 'done';
}

export async function resetOnboarding(): Promise<void> {
  await SecureStore.deleteItemAsync(ONBOARDING_STORE);
}

/**
 * Deterministic 32-byte memo hash for a request memo. The program treats this
 * as opaque; we derive it from the memo text via SHA-512 (nacl.hash) truncated
 * to 32 bytes so the same memo always maps to the same handle.
 */
export function memoHash(memo: string): number[] {
  if (!memo) return new Array(32).fill(0);
  const full = nacl.hash(new TextEncoder().encode(memo)); // 64 bytes
  return Array.from(full.slice(0, 32));
}
