/**
 * Onboarding — Haven flow: Welcome → Connect a wallet → Create your private
 * account (sign) → Add first funds. Wired to the real WalletContext:
 *   connect  → createWallet()  (local ed25519 key in secure store)
 *   protect  → authenticate()  (TEE auth challenge + registry)
 *   fund     → deposit()       (delegates + shields a first deposit)
 *
 * Resumable: the initial step is derived from persisted wallet state, so a
 * killed/backgrounded app resumes where it left off.
 */
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Pressable, View } from 'react-native';
import { ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWallet } from '../context/WalletContext';
import { deposit } from '../lib/actions';
import { addActivity } from '../lib/activity';
import { ensureRegistered } from '../lib/relay';
import { T, PrimaryButton, GhostButton, Logo, MarkAvatar } from '../components/haven';
import { Icon } from '../components/icons';
import { haven } from '../theme';

const WALLETS = [
  { name: 'Nova Wallet', sub: 'Detected on this device' },
  { name: 'KeyRing', sub: 'Mobile wallet' },
  { name: 'Hardware device', sub: 'Connect over USB or NFC' },
];
const FUND_OPTS = [100, 500, 1000];
const fmt0 = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });

export function OnboardingScreen() {
  const w = useWallet();

  const initialStep = (() => {
    if (!w.signer) return 0;
    if (!w.authed) return 2;
    return 3;
  })();

  const [step, setStep] = useState(initialStep);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [fundPick, setFundPick] = useState(500);

  const err = (e: unknown) => Alert.alert('Something went wrong', (e as Error).message);

  const connect = async (name: string) => {
    if (connecting) return;
    setConnecting(name);
    try {
      await w.createWallet();
      setStep(2);
    } catch (e) {
      err(e);
    } finally {
      setConnecting(null);
    }
  };

  const protectAccount = async () => {
    setBusy(true);
    try {
      await w.authenticate();
      if (w.publicKey) await ensureRegistered(w.publicKey).catch(() => {});
      setStep(3);
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };

  const fund = async () => {
    if (!w.signer) return;
    setBusy(true);
    try {
      await deposit(w.signer, fundPick);
      await addActivity({ kind: 'in', title: 'Added funds', amount: fundPick });
      await w.advanceStep('done');
      await w.refreshBalance();
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };

  const skip = () => w.advanceStep('done').catch(err);

  const seg = (on: boolean) => (on ? haven.green : '#DCE2DE');

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* progress */}
        {step > 0 && (
          <View style={{ gap: 8, marginBottom: 8 }}>
            <View style={{ flexDirection: 'row', gap: 6 }}>
              <View style={[styles.segBar, { backgroundColor: seg(step >= 1) }]} />
              <View style={[styles.segBar, { backgroundColor: seg(step >= 2) }]} />
              <View style={[styles.segBar, { backgroundColor: seg(step >= 3) }]} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              {['Connect', 'Protect', 'Fund'].map((l) => (
                <T key={l} weight="semibold" size={11} color={haven.inkFaint} style={styles.segLabel}>
                  {l.toUpperCase()}
                </T>
              ))}
            </View>
          </View>
        )}

        {/* step 0 · welcome */}
        {step === 0 && (
          <View style={{ flex: 1 }}>
            <View style={styles.welcomeCenter}>
              <View style={styles.welcomeLogo}>
                <View style={styles.welcomeRing} />
              </View>
              <T weight="bold" size={30} style={{ textAlign: 'center', letterSpacing: -0.6, marginBottom: 10 }}>
                Money that keeps{'\n'}to itself.
              </T>
              <T size={15} color={haven.inkDim} style={{ textAlign: 'center', lineHeight: 23, maxWidth: 290 }}>
                A private balance for you. Bounded, revocable budgets for the agents that spend on your behalf.
              </T>
              <View style={styles.badge}>
                <Icon name="shield" size={13} color={haven.green} strokeWidth={2} />
                <T weight="semibold" size={12.5} color={haven.green}>
                  Shielded by default
                </T>
              </View>
            </View>
            <View style={{ gap: 10 }}>
              <PrimaryButton title="Get started" onPress={() => setStep(1)} />
              <T size={12.5} color={haven.inkFaint} style={{ textAlign: 'center' }}>
                Takes about a minute. Safe to leave and come back.
              </T>
            </View>
          </View>
        )}

        {/* step 1 · connect */}
        {step === 1 && (
          <View style={{ flex: 1, paddingTop: 24 }}>
            <T weight="bold" size={24} style={{ letterSpacing: -0.5, marginBottom: 8 }}>
              Connect a wallet
            </T>
            <T size={14} color={haven.inkDim} style={{ lineHeight: 21, marginBottom: 24 }}>
              Your wallet stays yours. Haven only asks it to sign — never to hand over keys.
            </T>
            <View style={{ gap: 10 }}>
              {WALLETS.map((wal) => (
                <Pressable key={wal.name} onPress={() => connect(wal.name)} style={styles.walletRow}>
                  <MarkAvatar name={wal.name} size={38} />
                  <View style={{ flex: 1 }}>
                    <T weight="semibold" size={15}>
                      {wal.name}
                    </T>
                    <T size={12.5} color={haven.inkFaint}>
                      {wal.sub}
                    </T>
                  </View>
                  {connecting === wal.name && <ActivityIndicator color={haven.green} />}
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* step 2 · protect */}
        {step === 2 && (
          <View style={{ flex: 1, paddingTop: 24 }}>
            <T weight="bold" size={24} style={{ letterSpacing: -0.5, marginBottom: 8 }}>
              Create your private account
            </T>
            <T size={14} color={haven.inkDim} style={{ lineHeight: 21, marginBottom: 28 }}>
              One signature proves this shielded space is yours. Nothing here will appear on public explorers.
            </T>
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              {busy ? (
                <View style={{ alignItems: 'center', gap: 18 }}>
                  <View style={styles.protectBusy}>
                    <ActivityIndicator color={haven.green} size="large" />
                  </View>
                  <View style={{ alignItems: 'center' }}>
                    <T weight="semibold" size={15}>
                      Confirming on-chain
                    </T>
                    <T size={12.5} color={haven.inkFaint} style={{ marginTop: 4, textAlign: 'center' }}>
                      About 10 seconds. Safe to leave — we'll pick up where you left off.
                    </T>
                  </View>
                </View>
              ) : (
                <View style={styles.protectShield}>
                  <Icon name="shieldCheck" size={52} color="#DFF0E8" strokeWidth={1.8} />
                </View>
              )}
            </View>
            {!busy && <PrimaryButton title="Sign & protect my account" onPress={protectAccount} />}
          </View>
        )}

        {/* step 3 · fund */}
        {step === 3 && (
          <View style={{ flex: 1, paddingTop: 24 }}>
            <T weight="bold" size={24} style={{ letterSpacing: -0.5, marginBottom: 8 }}>
              Add your first funds
            </T>
            <T size={14} color={haven.inkDim} style={{ lineHeight: 21, marginBottom: 26 }}>
              Money moves into your shielded balance. From here on, only you can see it.
            </T>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
              {FUND_OPTS.map((v) => {
                const sel = fundPick === v;
                return (
                  <Pressable
                    key={v}
                    onPress={() => setFundPick(v)}
                    style={[
                      styles.fundOpt,
                      {
                        borderColor: sel ? haven.green : haven.border,
                        backgroundColor: sel ? haven.greenTintBg : haven.card,
                      },
                    ]}
                  >
                    <T weight="bold" size={16} color={sel ? haven.green : haven.inkSoft}>
                      {fmt0(v)}
                    </T>
                  </Pressable>
                );
              })}
            </View>
            {busy && (
              <View style={styles.fundBusy}>
                <ActivityIndicator color={haven.green} />
                <T size={13.5} color={haven.inkDim}>
                  Moving {fmt0(fundPick)} into your private balance…
                </T>
              </View>
            )}
            <View style={{ flex: 1 }} />
            {!busy && (
              <View style={{ gap: 10 }}>
                <PrimaryButton title={`Add ${fmt0(fundPick)} & finish`} onPress={fund} />
                <GhostButton title="Skip for now" onPress={skip} />
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: haven.screen },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 28 },
  segBar: { flex: 1, height: 4, borderRadius: 2 },
  segLabel: { letterSpacing: 0.5 },
  welcomeCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  welcomeLogo: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: haven.greenDeep,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  welcomeRing: { width: 34, height: 34, borderRadius: 17, borderWidth: 3.5, borderColor: '#EAF4EE' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: haven.greenTintBg,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
    marginTop: 26,
  },
  walletRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: haven.card,
    borderWidth: 1,
    borderColor: haven.border,
    borderRadius: 16,
    padding: 16,
  },
  protectBusy: {
    width: 72,
    height: 72,
    borderRadius: 22,
    backgroundColor: haven.greenTintBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  protectShield: {
    width: 130,
    height: 130,
    borderRadius: 36,
    backgroundColor: haven.greenDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fundOpt: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  fundBusy: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: haven.card,
    borderWidth: 1,
    borderColor: haven.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
});
