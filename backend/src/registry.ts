/**
 * registry.ts — in-memory device token registry.
 *
 * The ONLY state the relay keeps: wallet pubkey -> set of Expo push tokens.
 * There is deliberately no database and nothing financial here (see PRIVACY.md).
 */

export class TokenRegistry {
  private readonly byWallet = new Map<string, Set<string>>();

  /** Register a push token for a wallet. Idempotent. */
  add(wallet: string, pushToken: string): void {
    let tokens = this.byWallet.get(wallet);
    if (!tokens) {
      tokens = new Set();
      this.byWallet.set(wallet, tokens);
    }
    tokens.add(pushToken);
  }

  /** Remove one push token for a wallet. Cleans up empty wallets. */
  remove(wallet: string, pushToken: string): void {
    const tokens = this.byWallet.get(wallet);
    if (!tokens) return;
    tokens.delete(pushToken);
    if (tokens.size === 0) this.byWallet.delete(wallet);
  }

  /** Current push tokens for a wallet (empty array if unknown). */
  tokensFor(wallet: string): string[] {
    return [...(this.byWallet.get(wallet) ?? [])];
  }
}
