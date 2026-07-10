/**
 * index.ts — entry point. Wires the real Expo pusher into the server and listens.
 * Devnet-only prototype; no secrets, no mainnet anything.
 */

import { buildServer } from "./server.js";
import { ExpoPusher } from "./pusher.js";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";

const app = buildServer(new ExpoPusher());

app
  .listen({ port: PORT, host: HOST })
  .then((address) => {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({ msg: "relay listening", address }));
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error("failed to start relay", err);
    process.exit(1);
  });
