/**
 * Schema test — the important one. Guards the privacy contract at the choke
 * point: buildPushMessage(type, id) must produce ONLY the allowed fields, its
 * `data` must deep-equal `{type, id}`, and the serialized message must never
 * contain any financial probe string, because such data was never passed in.
 */

import { describe, it, expect } from "vitest";
import {
  buildPushMessage,
  NOTIFY_TYPES,
  type NotifyType,
} from "../src/messages.js";

// Things the relay must NEVER be able to emit. None of these are ever passed to
// buildPushMessage, so they must never appear in the serialized output.
const FORBIDDEN_PROBES = [
  "1000000", // an amount in base units
  "1000", // an amount
  "42.5", // a formatted amount
  "USDC", // a mint symbol
  "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", // a mint pubkey
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", // a counterparty pubkey
  "memo", // a memo field name
  "balance", // a balance field name
  "merchant", // a counterparty
  "amount", // an amount field name
];

describe("buildPushMessage", () => {
  it("covers exactly the four supported types", () => {
    expect([...NOTIFY_TYPES]).toEqual([
      "new_request",
      "request_responded",
      "agent_payment",
      "approval_needed",
    ]);
  });

  for (const type of NOTIFY_TYPES) {
    describe(`type=${type}`, () => {
      const id = "req123";
      const msg = buildPushMessage(type as NotifyType, id);

      it("has only the allowed top-level fields", () => {
        expect(Object.keys(msg).sort()).toEqual(["body", "data", "title"]);
      });

      it("data deep-equals exactly {type, id}", () => {
        expect(msg.data).toEqual({ type, id });
        expect(Object.keys(msg.data).sort()).toEqual(["id", "type"]);
      });

      it("has generic, non-empty title/body", () => {
        expect(typeof msg.title).toBe("string");
        expect(typeof msg.body).toBe("string");
        expect(msg.title.length).toBeGreaterThan(0);
        expect(msg.body.length).toBeGreaterThan(0);
      });

      it("serialized message contains no forbidden probe strings", () => {
        const serialized = JSON.stringify(msg);
        for (const probe of FORBIDDEN_PROBES) {
          expect(serialized).not.toContain(probe);
        }
      });

      it("serialized message contains the opaque id and type (and nothing else leaks)", () => {
        const serialized = JSON.stringify(msg);
        expect(serialized).toContain(id);
        expect(serialized).toContain(type);
      });
    });
  }

  it("does not leak an amount even when the id looks benign", () => {
    // Inject a distinctive id, then assert an amount that was never passed
    // cannot appear — proving the payload only carries what it was given.
    const msg = buildPushMessage("agent_payment", "corr-abc");
    const serialized = JSON.stringify(msg);
    expect(serialized).toContain("corr-abc");
    expect(serialized).not.toContain("1000000");
  });
});
