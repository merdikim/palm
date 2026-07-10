/**
 * pusher.ts — Expo push behind a small interface.
 *
 * The `Pusher` interface is the seam that lets tests inject a mock so the suite
 * never touches Expo's servers. Production wires in `ExpoPusher`.
 */

import { Expo, type ExpoPushMessage } from "expo-server-sdk";
import type { PushMessage } from "./messages.js";

export interface Pusher {
  /**
   * Deliver one content-free message to a set of device push tokens.
   * Implementations must not add any field to `message.data` beyond what is
   * given — the payload is fixed upstream in buildPushMessage.
   */
  send(tokens: string[], message: PushMessage): Promise<void>;
}

/** Real Expo implementation. Only used by the running server, never by tests. */
export class ExpoPusher implements Pusher {
  private readonly expo: Expo;

  constructor(expo: Expo = new Expo()) {
    this.expo = expo;
  }

  async send(tokens: string[], message: PushMessage): Promise<void> {
    const valid = tokens.filter((t) => Expo.isExpoPushToken(t));
    if (valid.length === 0) return;

    const messages: ExpoPushMessage[] = valid.map((to) => ({
      to,
      title: message.title,
      body: message.body,
      data: message.data,
    }));

    const chunks = this.expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      // Best-effort delivery; a failed chunk must never leak payload contents.
      await this.expo.sendPushNotificationsAsync(chunk);
    }
  }
}

/** In-memory mock for tests: records every call, hits no network. */
export class MockPusher implements Pusher {
  public readonly calls: { tokens: string[]; message: PushMessage }[] = [];

  async send(tokens: string[], message: PushMessage): Promise<void> {
    this.calls.push({ tokens: [...tokens], message });
  }
}
