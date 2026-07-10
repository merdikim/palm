/**
 * Token registry + dispatch + input validation tests, driven through the
 * Fastify app with a MockPusher (never hits Expo).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { buildServer } from "../src/server.js";
import { MockPusher } from "../src/pusher.js";
import { TokenRegistry } from "../src/registry.js";

// Valid base58 32-byte pubkeys (System program, Token program).
const WALLET_A = "11111111111111111111111111111111";
const WALLET_B = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const UNKNOWN_WALLET = "So11111111111111111111111111111111111111112";

const TOKEN_1 = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";
const TOKEN_2 = "ExponentPushToken[yyyyyyyyyyyyyyyyyyyyyy]";

function setup() {
  const pusher = new MockPusher();
  const registry = new TokenRegistry();
  const app = buildServer(pusher, { registry });
  return { pusher, registry, app };
}

describe("GET /health", () => {
  it("returns ok", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("registration + dispatch", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("register → notify dispatches to the wallet's tokens", async () => {
    const { app, pusher } = ctx;

    await app.inject({
      method: "POST",
      url: "/register",
      payload: { wallet: WALLET_A, pushToken: TOKEN_1 },
    });
    await app.inject({
      method: "POST",
      url: "/register",
      payload: { wallet: WALLET_A, pushToken: TOKEN_2 },
    });

    const res = await app.inject({
      method: "POST",
      url: "/notify",
      payload: { targetWallet: WALLET_A, type: "new_request", id: "abc" },
    });

    expect(res.statusCode).toBe(200);
    expect(pusher.calls).toHaveLength(1);
    expect(pusher.calls[0].tokens.sort()).toEqual([TOKEN_1, TOKEN_2].sort());
    expect(pusher.calls[0].message.data).toEqual({
      type: "new_request",
      id: "abc",
    });
  });

  it("only notifies the target wallet's tokens", async () => {
    const { app, pusher } = ctx;
    await app.inject({
      method: "POST",
      url: "/register",
      payload: { wallet: WALLET_A, pushToken: TOKEN_1 },
    });
    await app.inject({
      method: "POST",
      url: "/register",
      payload: { wallet: WALLET_B, pushToken: TOKEN_2 },
    });

    await app.inject({
      method: "POST",
      url: "/notify",
      payload: { targetWallet: WALLET_B, type: "agent_payment", id: "z" },
    });

    expect(pusher.calls).toHaveLength(1);
    expect(pusher.calls[0].tokens).toEqual([TOKEN_2]);
  });

  it("deregister removes the token so no push is sent", async () => {
    const { app, pusher } = ctx;
    await app.inject({
      method: "POST",
      url: "/register",
      payload: { wallet: WALLET_A, pushToken: TOKEN_1 },
    });
    const del = await app.inject({
      method: "DELETE",
      url: "/register",
      payload: { wallet: WALLET_A, pushToken: TOKEN_1 },
    });
    expect(del.statusCode).toBe(200);

    const res = await app.inject({
      method: "POST",
      url: "/notify",
      payload: { targetWallet: WALLET_A, type: "new_request", id: "abc" },
    });
    expect(res.statusCode).toBe(200);
    expect(pusher.calls).toHaveLength(0);
  });

  it("notify to an unknown wallet is a no-op but still 200", async () => {
    const { app, pusher } = ctx;
    const res = await app.inject({
      method: "POST",
      url: "/notify",
      payload: {
        targetWallet: UNKNOWN_WALLET,
        type: "approval_needed",
        id: "q",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(pusher.calls).toHaveLength(0);
  });
});

describe("input validation → 400", () => {
  let app: ReturnType<typeof setup>["app"];
  beforeEach(() => {
    app = setup().app;
  });

  it("rejects a bad wallet on /register", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/register",
      payload: { wallet: "not-a-pubkey!!", pushToken: TOKEN_1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a bad push token on /register", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/register",
      payload: { wallet: WALLET_A, pushToken: "not-an-expo-token" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a bad wallet on /notify", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/notify",
      payload: { targetWallet: "bad", type: "new_request", id: "abc" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unknown type on /notify", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/notify",
      payload: { targetWallet: WALLET_A, type: "leak_amount", id: "abc" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a missing id on /notify", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/notify",
      payload: { targetWallet: WALLET_A, type: "new_request" },
    });
    expect(res.statusCode).toBe(400);
  });
});
