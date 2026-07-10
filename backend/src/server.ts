/**
 * server.ts — Fastify app factory.
 *
 * `buildServer(pusher)` returns a configured Fastify instance with an injected
 * Pusher (real in production, mock in tests). The relay keeps exactly one piece
 * of state: an in-memory device-token registry. See docs/PRIVACY.md.
 */

import Fastify, { type FastifyInstance } from "fastify";
import { buildPushMessage, type NotifyType } from "./messages.js";
import type { Pusher } from "./pusher.js";
import { TokenRegistry } from "./registry.js";
import { registerSchema, notifySchema } from "./validation.js";

export interface ServerOptions {
  registry?: TokenRegistry;
}

export function buildServer(
  pusher: Pusher,
  opts: ServerOptions = {},
): FastifyInstance {
  // Disable Fastify's default request logger; we log a scrubbed line ourselves
  // so full wallets, ids, and bodies never reach the logs.
  const app = Fastify({ logger: false });
  const registry = opts.registry ?? new TokenRegistry();

  /**
   * Scrubbed access log. The relay may log ONLY these fields (PRIVACY.md):
   * method, path, event type, and the first 4 chars of the target wallet.
   * Never the full wallet, the opaque id, push tokens, or the raw body.
   */
  function logScrubbed(
    method: string,
    path: string,
    type?: string,
    wallet?: string,
  ): void {
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        method,
        path,
        type: type ?? null,
        targetWalletPrefix: wallet ? wallet.slice(0, 4) : null,
      }),
    );
  }

  /**
   * Internal dispatch: look up the target wallet's tokens and send the fixed
   * content-free payload. This is the single sink both the client-initiated
   * `/notify` handler and any future SubscriptionSource would call.
   */
  async function dispatch(
    type: NotifyType,
    id: string,
    targetWallet: string,
  ): Promise<void> {
    const tokens = registry.tokensFor(targetWallet);
    if (tokens.length === 0) return; // unknown / unregistered wallet: no-op
    await pusher.send(tokens, buildPushMessage(type, id));
  }

  app.get("/health", async () => {
    return { status: "ok" };
  });

  app.post("/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      logScrubbed("POST", "/register");
      return reply.code(400).send({ error: "invalid_request" });
    }
    const { wallet, pushToken } = parsed.data;
    registry.add(wallet, pushToken);
    logScrubbed("POST", "/register", undefined, wallet);
    return reply.code(200).send({ ok: true });
  });

  app.delete("/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      logScrubbed("DELETE", "/register");
      return reply.code(400).send({ error: "invalid_request" });
    }
    const { wallet, pushToken } = parsed.data;
    registry.remove(wallet, pushToken);
    logScrubbed("DELETE", "/register", undefined, wallet);
    return reply.code(200).send({ ok: true });
  });

  // ACCEPTED LIMITATION (prototype): client-initiated pings are UNAUTHENTICATED
  // here — any caller can request a push for any registered wallet. A production
  // version would authenticate the pinging client and/or replace this with a
  // service-token ER subscription (a SubscriptionSource) that calls the same
  // internal `dispatch(type, id, targetWallet)`. The payload stays content-free
  // regardless of source, so the privacy contract holds either way.
  app.post("/notify", async (request, reply) => {
    const parsed = notifySchema.safeParse(request.body);
    if (!parsed.success) {
      logScrubbed("POST", "/notify");
      return reply.code(400).send({ error: "invalid_request" });
    }
    const { targetWallet, type, id } = parsed.data;
    await dispatch(type, id, targetWallet);
    // Always 200, even for an unknown wallet: the relay must not reveal whether
    // a given wallet is registered.
    logScrubbed("POST", "/notify", type, targetWallet);
    return reply.code(200).send({ ok: true });
  });

  return app;
}
