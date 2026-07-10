/**
 * messages.ts — the single choke point for the push payload.
 *
 * PRIVACY CONTRACT (see docs/PRIVACY.md): the relay may only ever emit a
 * push whose `data` is EXACTLY `{ type, id }` and whose visible title/body are
 * generic per-type strings that reveal nothing financial. No amounts, mints,
 * counterparties, memos, or balances may pass through here. This is the only
 * place a push message is constructed, so it is the only thing the schema test
 * needs to assert on.
 */

export const NOTIFY_TYPES = [
  "new_request",
  "request_responded",
  "agent_payment",
  "approval_needed",
] as const;

export type NotifyType = (typeof NOTIFY_TYPES)[number];

/** Generic, content-free copy per event type. Reveals nothing. */
const COPY: Record<NotifyType, { title: string; body: string }> = {
  new_request: {
    title: "New activity",
    body: "You have a new payment request",
  },
  request_responded: {
    title: "New activity",
    body: "A payment request was updated",
  },
  agent_payment: {
    title: "New activity",
    body: "An agent completed a payment",
  },
  approval_needed: {
    title: "New activity",
    body: "An action needs your approval",
  },
};

/**
 * The shape passed to the Expo SDK for a single device. It intentionally omits
 * `to`, which the pusher adds per-token; keeping `to` out of this function makes
 * the schema test's "only these fields" assertion exact and payload-focused.
 */
export interface PushMessage {
  title: string;
  body: string;
  data: { type: NotifyType; id: string };
}

/**
 * Pure function: build the content-free Expo push message for an event.
 * `id` is treated as an opaque deep-link handle — it is never parsed or logged.
 */
export function buildPushMessage(type: NotifyType, id: string): PushMessage {
  const copy = COPY[type];
  return {
    title: copy.title,
    body: copy.body,
    data: { type, id },
  };
}
