/**
 * Entry point.
 *
 * Polyfills MUST come first, before anything imports @solana/web3.js:
 *  - react-native-get-random-values: provides crypto.getRandomValues (used by
 *    tweetnacl / Keypair.generate).
 *  - buffer: global Buffer for web3.js / spl-token / our borsh layer.
 */
import 'react-native-get-random-values';
import { Buffer } from 'buffer';

// Attach Buffer to the RN global scope (web3.js / spl-token / borsh need it).
const g = global as unknown as { Buffer?: typeof Buffer };
g.Buffer = g.Buffer ?? Buffer;

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
