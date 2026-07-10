/**
 * Onboarding — create/import key -> TEE auth -> optional first deposit.
 * Resumable: the persisted onboarding step (WalletContext.step) drives which
 * sub-step renders, so backgrounding/killing the app resumes in place.
 */
import React, { useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { useWallet } from '../context/WalletContext';
import { deposit } from '../lib/actions';
import { ensureRegistered } from '../lib/relay';
import {
  Button,
  Card,
  Field,
  Label,
  Muted,
  ScreenTitle,
} from '../components/ui';
import { theme } from '../theme';
import { shortKey } from '../lib/format';

export function OnboardingScreen() {
  const w = useWallet();
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState('');
  const [amount, setAmount] = useState('10');
  const [importing, setImporting] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenTitle>Set up private payments</ScreenTitle>

      {/* Step 1: key */}
      <Card>
        <Label>Step 1 — Wallet key</Label>
        {w.publicKey ? (
          <Muted>Key ready: {shortKey(w.publicKey)}</Muted>
        ) : importing ? (
          <View>
            <Field
              placeholder="base58 secret key"
              value={secret}
              onChangeText={setSecret}
            />
            <Button
              title="Import key"
              loading={busy}
              onPress={() => run(() => w.importWallet(secret))}
            />
            <Button title="Back" variant="ghost" onPress={() => setImporting(false)} />
          </View>
        ) : (
          <View>
            <Muted>
              Generates a local ed25519 keypair stored in the device secure
              store, behind a Signer interface (MWA/embedded wallets can replace
              it later).
            </Muted>
            <View style={{ height: theme.space(3) }} />
            <Button
              title="Create new key"
              loading={busy}
              onPress={() => run(() => w.createWallet())}
            />
            <Button title="Import existing" variant="ghost" onPress={() => setImporting(true)} />
          </View>
        )}
      </Card>

      {/* Step 2: TEE auth */}
      <Card>
        <Label>Step 2 — Authenticate to the private rollup</Label>
        <Muted>
          Signs the TEE auth challenge and caches a JWT (expiry-aware). Required
          to read your private balance.
        </Muted>
        <View style={{ height: theme.space(3) }} />
        <Button
          title={w.authed ? 'Authenticated ✓' : 'Sign challenge'}
          disabled={!w.publicKey || w.authed}
          loading={busy}
          onPress={() =>
            run(async () => {
              await w.authenticate();
              if (w.publicKey) await ensureRegistered(w.publicKey);
            })
          }
        />
      </Card>

      {/* Step 3: optional first deposit (also onboards you as a recipient) */}
      <Card>
        <Label>Step 3 — First deposit (optional)</Label>
        <Muted>
          A first deposit delegates your token account on the ER, which also lets
          others send you private payments (onboarding, spikes S2#7).
        </Muted>
        <View style={{ height: theme.space(3) }} />
        <Field
          placeholder="USDC amount"
          keyboardType="decimal-pad"
          value={amount}
          onChangeText={setAmount}
        />
        <Button
          title="Deposit"
          disabled={!w.authed}
          loading={busy}
          onPress={() =>
            run(async () => {
              if (!w.signer) return;
              await deposit(w.signer, Number(amount));
              await w.advanceStep('done');
              await w.refreshBalance();
            })
          }
        />
        <Button
          title="Skip for now"
          variant="ghost"
          disabled={!w.authed}
          onPress={() => run(() => w.advanceStep('done'))}
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: theme.space(4), paddingTop: theme.space(6) },
});
