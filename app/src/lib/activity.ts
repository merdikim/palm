/**
 * activity.ts — a small local, append-only activity feed.
 *
 * The private rollup has no user-facing activity index, so we record each money
 * action the user takes (deposit, send, withdraw, agent payment) locally. This
 * is a convenience log only — the chain remains the source of truth.
 */
import * as SecureStore from 'expo-secure-store';

const STORE = 'palm.activity.v1';

export type ActivityKind = 'in' | 'out' | 'agent' | 'w';

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  title: string;
  /** signed dollars: positive = money in, negative = money out */
  amount: number;
  ts: number;
  pending?: boolean;
}

async function readAll(): Promise<ActivityItem[]> {
  const raw = await SecureStore.getItemAsync(STORE);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ActivityItem[];
  } catch {
    return [];
  }
}

async function writeAll(items: ActivityItem[]): Promise<void> {
  await SecureStore.setItemAsync(STORE, JSON.stringify(items.slice(0, 50)));
}

export async function listActivity(): Promise<ActivityItem[]> {
  return readAll();
}

export async function addActivity(
  item: Omit<ActivityItem, 'id' | 'ts'> & { id?: string; ts?: number },
): Promise<ActivityItem> {
  const all = await readAll();
  const entry: ActivityItem = {
    id: item.id ?? `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
    ts: item.ts ?? Date.now(),
    kind: item.kind,
    title: item.title,
    amount: item.amount,
    pending: item.pending,
  };
  await writeAll([entry, ...all]);
  return entry;
}

export async function markActivitySettled(id: string): Promise<void> {
  const all = await readAll();
  await writeAll(all.map((a) => (a.id === id ? { ...a, pending: false } : a)));
}

export async function clearActivity(): Promise<void> {
  await SecureStore.deleteItemAsync(STORE);
}

/** "Today · 9:14" style relative-ish label. */
export function activityTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  const yesterday = d.toDateString() === y.toDateString();
  const hm = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `Today · ${hm}`;
  if (yesterday) return `Yesterday · ${hm}`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
