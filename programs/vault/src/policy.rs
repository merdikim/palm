//! Pure policy evaluation for `agent_pay`. No Anchor account types here so the
//! whole decision tree is unit-testable on the host with `cargo test`.

use crate::state::DAY_SECONDS;

/// Pure policy error, independent of Anchor. Mapped to `VaultError` at the
/// instruction boundary so the whole decision tree is host-unit-testable.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PolicyError {
    ZeroAmount,
    VaultExpired,
    AgentSelfPay,
    MerchantNotAllowed,
    ExceedsPerTx,
    ExceedsDailyLimit,
    SlippageExceeded,
    Overflow,
}

#[derive(Debug, PartialEq, Eq)]
pub enum PolicyOutcome {
    /// Execute the payment now, debiting this many USDC base units.
    Execute { usdc_debit: u64 },
    /// Debit exceeds the approval threshold → create a PaymentRequest instead.
    NeedsApproval { usdc_debit: u64 },
}

/// Inputs for a single agent_pay policy evaluation.
pub struct PolicyInput {
    pub now: i64,
    pub expiry: Option<i64>,
    pub max_per_tx: u64,
    pub max_slippage_bps: u16,
    pub daily_limit: Option<u64>,
    pub approval_threshold: Option<u64>,
    /// Effective spent_today AFTER the rolling-window reset has been applied.
    pub effective_spent_today: u64,
    // Merchant checks (resolved by the caller against the account list):
    pub has_allowlist: bool,
    pub merchant_on_allowlist: bool,
    pub merchant_is_agent: bool,
    // The requested payment:
    pub amount_out: u64,
    pub usdc_debit: u64,
    pub quoted_slippage_bps: u16,
}

/// Roll the daily window forward. Returns `(window_start, effective_spent)`:
/// if a full day elapsed since `window_start`, the window resets to `now`/0.
pub fn effective_daily(window_start: i64, spent_today: u64, now: i64) -> (i64, u64) {
    if now.saturating_sub(window_start) >= DAY_SECONDS {
        (now, 0)
    } else {
        (window_start, spent_today)
    }
}

/// Evaluate every policy branch, in the spec's order:
/// expiry → allowlist / self-pay → amounts → per-tx → daily → slippage → threshold.
pub fn evaluate(i: &PolicyInput) -> Result<PolicyOutcome, PolicyError> {
    // 0. sanity
    if i.amount_out == 0 || i.usdc_debit == 0 {
        return Err(PolicyError::ZeroAmount);
    }

    // 1. expiry
    if let Some(e) = i.expiry {
        if i.now >= e {
            return Err(PolicyError::VaultExpired);
        }
    }

    // 2. self-pay: agent may only pay itself if explicitly allowlisted.
    if i.merchant_is_agent && !(i.has_allowlist && i.merchant_on_allowlist) {
        return Err(PolicyError::AgentSelfPay);
    }

    // 3. allowlist (if configured)
    if i.has_allowlist && !i.merchant_on_allowlist {
        return Err(PolicyError::MerchantNotAllowed);
    }

    // 4. per-tx cap (on the USDC debit)
    if i.usdc_debit > i.max_per_tx {
        return Err(PolicyError::ExceedsPerTx);
    }

    // 5. daily limit (on the effective, window-reset counter)
    if let Some(limit) = i.daily_limit {
        let projected = i
            .effective_spent_today
            .checked_add(i.usdc_debit)
            .ok_or(PolicyError::Overflow)?;
        if projected > limit {
            return Err(PolicyError::ExceedsDailyLimit);
        }
    }

    // 6. slippage bound
    if i.quoted_slippage_bps > i.max_slippage_bps {
        return Err(PolicyError::SlippageExceeded);
    }

    // 7. approval threshold → request path
    if let Some(t) = i.approval_threshold {
        if i.usdc_debit > t {
            return Ok(PolicyOutcome::NeedsApproval {
                usdc_debit: i.usdc_debit,
            });
        }
    }

    Ok(PolicyOutcome::Execute {
        usdc_debit: i.usdc_debit,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> PolicyInput {
        PolicyInput {
            now: 1_000_000,
            expiry: None,
            max_per_tx: 50_000_000,       // 50 USDC
            max_slippage_bps: 100,        // 1%
            daily_limit: None,
            approval_threshold: None,
            effective_spent_today: 0,
            has_allowlist: false,
            merchant_on_allowlist: false,
            merchant_is_agent: false,
            amount_out: 10_000_000,       // 10 USDC-equivalent out
            usdc_debit: 10_000_000,       // 10 USDC in
            quoted_slippage_bps: 0,
        }
    }

    #[test]
    fn happy_path_executes() {
        assert_eq!(
            evaluate(&base()).unwrap(),
            PolicyOutcome::Execute { usdc_debit: 10_000_000 }
        );
    }

    #[test]
    fn zero_amount_rejected() {
        let mut i = base();
        i.amount_out = 0;
        assert_eq!(evaluate(&i).unwrap_err(), PolicyError::ZeroAmount);
        let mut j = base();
        j.usdc_debit = 0;
        assert_eq!(evaluate(&j).unwrap_err(), PolicyError::ZeroAmount);
    }

    #[test]
    fn expiry_enforced() {
        let mut i = base();
        i.expiry = Some(1_000_000); // now >= expiry
        assert_eq!(evaluate(&i).unwrap_err(), PolicyError::VaultExpired);
        i.expiry = Some(1_000_001); // still valid
        assert!(evaluate(&i).is_ok());
    }

    #[test]
    fn per_tx_cap() {
        let mut i = base();
        i.usdc_debit = 50_000_001;
        assert_eq!(evaluate(&i).unwrap_err(), PolicyError::ExceedsPerTx);
        i.usdc_debit = 50_000_000; // exactly at cap is OK
        assert!(evaluate(&i).is_ok());
    }

    #[test]
    fn daily_limit_and_projection() {
        let mut i = base();
        i.daily_limit = Some(30_000_000);
        i.effective_spent_today = 25_000_000;
        i.usdc_debit = 5_000_000; // 25+5 = 30 == limit OK
        assert!(evaluate(&i).is_ok());
        i.usdc_debit = 5_000_001; // 30_000_001 > 30_000_000
        assert_eq!(evaluate(&i).unwrap_err(), PolicyError::ExceedsDailyLimit);
    }

    #[test]
    fn daily_window_reset() {
        // Just under a day → no reset.
        let (ws, spent) = effective_daily(1000, 40_000_000, 1000 + DAY_SECONDS - 1);
        assert_eq!((ws, spent), (1000, 40_000_000));
        // A full day later → reset.
        let (ws2, spent2) = effective_daily(1000, 40_000_000, 1000 + DAY_SECONDS);
        assert_eq!((ws2, spent2), (1000 + DAY_SECONDS, 0));
    }

    #[test]
    fn allowlist_hit_and_miss() {
        let mut i = base();
        i.has_allowlist = true;
        i.merchant_on_allowlist = false;
        assert_eq!(evaluate(&i).unwrap_err(), PolicyError::MerchantNotAllowed);
        i.merchant_on_allowlist = true;
        assert!(evaluate(&i).is_ok());
    }

    #[test]
    fn agent_self_pay_blocked_unless_allowlisted() {
        let mut i = base();
        i.merchant_is_agent = true;
        // no allowlist → blocked
        assert_eq!(evaluate(&i).unwrap_err(), PolicyError::AgentSelfPay);
        // allowlist present but agent not on it → blocked
        i.has_allowlist = true;
        i.merchant_on_allowlist = false;
        assert_eq!(evaluate(&i).unwrap_err(), PolicyError::AgentSelfPay);
        // explicitly allowlisted → allowed (documented residual risk)
        i.merchant_on_allowlist = true;
        assert!(evaluate(&i).is_ok());
    }

    #[test]
    fn slippage_bound() {
        let mut i = base();
        i.quoted_slippage_bps = 101; // > 100
        assert_eq!(evaluate(&i).unwrap_err(), PolicyError::SlippageExceeded);
        i.quoted_slippage_bps = 100; // exactly at bound OK
        assert!(evaluate(&i).is_ok());
    }

    #[test]
    fn threshold_routes_to_approval() {
        let mut i = base();
        i.approval_threshold = Some(10_000_000);
        i.usdc_debit = 10_000_000; // == threshold executes
        assert_eq!(evaluate(&i).unwrap(), PolicyOutcome::Execute { usdc_debit: 10_000_000 });
        i.usdc_debit = 10_000_001; // > threshold → approval
        assert_eq!(evaluate(&i).unwrap(), PolicyOutcome::NeedsApproval { usdc_debit: 10_000_001 });
    }

    #[test]
    fn evaluation_order_expiry_before_slippage() {
        // Expired vault with also-bad slippage should report expiry first.
        let mut i = base();
        i.expiry = Some(0);
        i.quoted_slippage_bps = 9999;
        assert_eq!(evaluate(&i).unwrap_err(), PolicyError::VaultExpired);
    }
}
