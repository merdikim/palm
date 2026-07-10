use anchor_lang::prelude::*;

/// Max entries in a vault's merchant allowlist (bounds account size).
pub const MAX_ALLOWLIST: usize = 16;

/// 24h daily-window length, in seconds (coarse reset — accepted limitation).
pub const DAY_SECONDS: i64 = 24 * 60 * 60;

/// Per-agent escrow vault. Its private token balance IS the allowance.
/// seeds = ["vault", owner, agent]
#[account]
pub struct AgentVault {
    pub owner: Pubkey,
    pub agent: Pubkey,
    pub bump: u8,
    /// Optional hard expiry (unix seconds). After this, agent_pay fails.
    pub expiry: Option<i64>,
    /// Tier 1 (always on): max USDC base units per single agent_pay.
    pub max_per_tx: u64,
    /// Tier 1: max tolerated slippage for the swap leg, basis points.
    pub max_slippage_bps: u16,
    /// Tier 2: optional rolling 24h spend cap (USDC base units).
    pub daily_limit: Option<u64>,
    pub spent_today: u64,
    pub window_start: i64,
    /// Tier 3: optional merchant allowlist. None = any merchant allowed
    /// (subject to the agent-can't-pay-itself rule).
    pub merchant_allowlist: Option<Vec<Pubkey>>,
    /// Tier 3: payments whose USDC debit exceeds this create a PaymentRequest
    /// for the owner to approve instead of executing immediately.
    pub approval_threshold: Option<u64>,
    /// Lifetime USDC spent through this vault (for the agents page).
    pub lifetime_spent: u64,
    pub payment_count: u32,
}

impl AgentVault {
    /// Worst-case size: fixed fields + full allowlist present.
    pub const MAX_SIZE: usize = 8   // discriminator
        + 32 + 32 + 1               // owner, agent, bump
        + (1 + 8)                   // expiry Option<i64>
        + 8 + 2                     // max_per_tx, max_slippage_bps
        + (1 + 8)                   // daily_limit Option<u64>
        + 8 + 8                     // spent_today, window_start
        + (1 + 4 + MAX_ALLOWLIST * 32) // merchant_allowlist Option<Vec<Pubkey>>
        + (1 + 8)                   // approval_threshold Option<u64>
        + 8 + 4; // lifetime_spent, payment_count

    pub fn is_expired(&self, now: i64) -> bool {
        matches!(self.expiry, Some(e) if now >= e)
    }

    pub fn merchant_allowed(&self, merchant: &Pubkey) -> bool {
        match &self.merchant_allowlist {
            Some(list) => list.iter().any(|m| m == merchant),
            None => true,
        }
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum RequestStatus {
    Pending,
    Accepted,
    Denied,
    Expired,
}

/// A request-to-pay. Created directly on the ER with permission members
/// {requester, payer}. Used for user-to-user requests AND agent over-threshold
/// approvals (then `vault` is set and `requester` is the agent).
/// seeds = ["request", payer, &request_id.to_le_bytes()]
#[account]
pub struct PaymentRequest {
    pub requester: Pubkey,
    pub payer: Pubkey,
    /// Set when this is an agent-approval request; None for user-to-user.
    pub vault: Option<Pubkey>,
    pub mint_out: Pubkey,
    pub amount_out: u64,
    /// Client-encrypted memo reference (opaque to the program).
    pub memo_hash: [u8; 32],
    pub status: RequestStatus,
    pub created_at: i64,
    pub expires_at: i64,
    /// Monotonic id from the payer's request counter (enables deterministic
    /// derivation + enumeration fallback — see docs/spikes.md S4).
    pub request_id: u64,
    pub bump: u8,
}

impl PaymentRequest {
    pub const MAX_SIZE: usize = 8
        + 32 + 32                 // requester, payer
        + (1 + 32)                // vault Option<Pubkey>
        + 32 + 8                  // mint_out, amount_out
        + 32                      // memo_hash
        + 1                       // status
        + 8 + 8                   // created_at, expires_at
        + 8 + 1; // request_id, bump
}

/// Per-payer monotonic counter for deterministic request PDAs.
/// seeds = ["req_counter", payer]
#[account]
pub struct RequestCounter {
    pub payer: Pubkey,
    pub next_id: u64,
    pub bump: u8,
}

impl RequestCounter {
    pub const MAX_SIZE: usize = 8 + 32 + 8 + 1;
}

/// Policy args for create_vault / update_policy (all optionals chosen at
/// creation; Tier 1 always present).
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Debug)]
pub struct VaultPolicy {
    pub max_per_tx: u64,
    pub max_slippage_bps: u16,
    pub daily_limit: Option<u64>,
    pub merchant_allowlist: Option<Vec<Pubkey>>,
    pub approval_threshold: Option<u64>,
    pub expiry: Option<i64>,
}

/// Quote context supplied by the agent for the swap leg. All policy caps are
/// enforced on `usdc_debit` (the USDC leaving the vault). For a direct USDC
/// payment, `usdc_debit == amount_out` and `quoted_slippage_bps == 0`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug)]
pub struct QuoteContext {
    /// USDC base units that will leave the vault to fulfill this payment.
    pub usdc_debit: u64,
    /// The quote's slippage vs. the reference price, in basis points.
    pub quoted_slippage_bps: u16,
}
