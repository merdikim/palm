/**
 * Entry point.
 *
 * `./polyfills` MUST be imported first — before `expo`/`App` and anything that
 * pulls in @solana/web3.js — so the global Buffer + crypto.getRandomValues
 * shims are installed before those modules evaluate. See polyfills.ts for why
 * this lives in a separate module rather than inline here.
 */
import './polyfills';

import { registerRootComponent } from 'expo';
import App from './App';

registerRootComponent(App);
