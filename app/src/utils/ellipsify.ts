/**
 * ellipsify — truncate a long string (e.g. a pubkey) to `head…tail`.
 * create-solana-dapp ships this exact helper; we reuse it app-wide.
 */
export function ellipsify(str = '', len = 4, delimiter = '…'): string {
  if (str.length <= len * 2 + delimiter.length) return str;
  return `${str.substring(0, len)}${delimiter}${str.substring(str.length - len)}`;
}
