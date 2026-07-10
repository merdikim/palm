/**
 * relay.ts — device push-token registration + content-free notify calls.
 *
 * The relay learns nothing financial (see backend/, docs/PRIVACY.md). It maps
 * wallet -> Expo push tokens and forwards a fixed `{ type, id }` payload. The
 * base URL is configurable (default local dev).
 *
 * NOTE: `expo-notifications` push tokens require a real device + a configured
 * projectId. On a simulator/web this will throw; callers should treat push
 * registration as best-effort and degrade gracefully.
 */
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { RELAY_BASE_URL } from './constants';

export const NOTIFY_TYPES = [
  'new_request',
  'request_responded',
  'agent_payment',
  'approval_needed',
] as const;
export type NotifyType = (typeof NOTIFY_TYPES)[number];

let baseUrl = RELAY_BASE_URL;
export function setRelayBaseUrl(url: string): void {
  baseUrl = url.replace(/\/$/, '');
}
export function getRelayBaseUrl(): string {
  return baseUrl;
}

/** Fetch the Expo push token for this device (throws off-device). */
export async function getExpoPushToken(): Promise<string> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (status !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') {
    throw new Error('Notification permission not granted');
  }
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  const { data } = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined,
  );
  return data;
}

async function relayFetch(
  path: string,
  method: string,
  body: unknown,
): Promise<void> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Relay ${res.status} ${path}`);
  }
}

/** Register (wallet -> pushToken) with the relay. */
export function registerDevice(wallet: string, pushToken: string): Promise<void> {
  return relayFetch('/register', 'POST', { wallet, pushToken });
}

export function unregisterDevice(wallet: string, pushToken: string): Promise<void> {
  return relayFetch('/register', 'DELETE', { wallet, pushToken });
}

/**
 * Ask the relay to push a content-free ping to `targetWallet`. `id` is an
 * opaque deep-link handle (never parsed/logged by the relay).
 */
export function notify(
  targetWallet: string,
  type: NotifyType,
  id: string,
): Promise<void> {
  return relayFetch('/notify', 'POST', { targetWallet, type, id });
}

/** Convenience: obtain a push token and register it, best-effort. */
export async function ensureRegistered(wallet: string): Promise<string | null> {
  try {
    const token = await getExpoPushToken();
    await registerDevice(wallet, token);
    return token;
  } catch {
    return null; // off-device or relay down — degrade gracefully
  }
}
