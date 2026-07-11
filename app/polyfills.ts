/**
 * Global polyfills — imported as the very first thing in index.ts.
 *
 * This MUST be its own module (not inline in index.ts): ES `import` statements
 * are hoisted, so an inline `global.Buffer = …` in index.ts would run *after*
 * `import App` and its `@solana/web3.js` / `spl-token` graph has already
 * evaluated and touched the (still-undefined) global `Buffer`. As a separate
 * side-effect import, this module's body fully runs before App is imported.
 *
 *  - react-native-get-random-values: crypto.getRandomValues (tweetnacl / Keypair)
 *  - buffer: global Buffer for web3.js / spl-token / our borsh layer
 */
import 'react-native-get-random-values';
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: typeof Buffer };
if (!g.Buffer) g.Buffer = Buffer;
