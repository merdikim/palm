use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Only the vault owner may perform this action")]
    NotOwner,
    #[msg("Signer is not the vault's agent")]
    NotAgent,
    #[msg("Only the request payer may respond")]
    NotPayer,
    #[msg("Vault has expired")]
    VaultExpired,
    #[msg("Merchant is not on the vault allowlist")]
    MerchantNotAllowed,
    #[msg("Agent cannot pay itself")]
    AgentSelfPay,
    #[msg("Amount exceeds max per-transaction limit")]
    ExceedsPerTx,
    #[msg("Amount exceeds the daily limit")]
    ExceedsDailyLimit,
    #[msg("Quote slippage exceeds the vault's max slippage")]
    SlippageExceeded,
    #[msg("Insufficient vault balance")]
    InsufficientFunds,
    #[msg("Merchant allowlist exceeds the maximum length")]
    AllowlistTooLong,
    #[msg("Request is not pending")]
    RequestNotPending,
    #[msg("Request has expired")]
    RequestExpired,
    #[msg("Request expiry must be in the future")]
    BadExpiry,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Quote debit does not cover the requested output")]
    BadQuote,
    #[msg("Numeric overflow")]
    Overflow,
    #[msg("Payment requires owner approval (over threshold)")]
    ApprovalRequired,
    #[msg("Mismatched token owner/mint for the provided accounts")]
    BadTokenAccounts,
}
