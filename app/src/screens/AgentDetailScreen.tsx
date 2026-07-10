/**
 * Agent detail — top up, edit policy (per-tx cap + daily limit), and revoke
 * (reclaim all + close). Owner-signed.
 */
import React, { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { PublicKey } from '@solana/web3.js';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useWallet } from '../context/WalletContext';
import {
  fetchVaultView,
  topUpVault,
  updateVaultPolicy,
  revokeVault,
  type VaultView,
} from '../lib/actions';
import { usdcBase, formatUsd, shortKey } from '../lib/format';
import { Button, Card, Field, Label, Muted, Row, ScreenTitle } from '../components/ui';
import { theme } from '../theme';
import type { AgentsStackParamList } from '../navigation/types';
import type { Policy } from '../lib/vault';

export function AgentDetailScreen() {
  const w = useWallet();
  const nav = useNavigation();
  const route = useRoute<RouteProp<AgentsStackParamList, 'AgentDetail'>>();
  const agent = route.params.agent;

  const [view, setView] = useState<VaultView | null>(null);
  const [busy, setBusy] = useState(false);
  const [topUp, setTopUp] = useState('');
  const [perTx, setPerTx] = useState('');
  const [daily, setDaily] = useState('');

  const load = useCallback(async () => {
    if (!w.signer) return;
    const v = await fetchVaultView(w.signer, { agent });
    setView(v);
    if (v.account) {
      setPerTx(String(Number(v.account.maxPerTx) / 1e6));
      setDaily(v.account.dailyLimit != null ? String(Number(v.account.dailyLimit) / 1e6) : '');
    }
  }, [w.signer, agent]);

  React.useEffect(() => {
    load().catch((e) => Alert.alert('Error', (e as Error).message));
  }, [load]);

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    if (!w.signer) return;
    setBusy(true);
    try {
      await fn();
      Alert.alert('Done', msg);
      await load();
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const agentPk = new PublicKey(agent);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenTitle>{view?.label ?? shortKey(agent)}</ScreenTitle>

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Label>Remaining allowance</Label>
          <Muted>{view ? formatUsd(view.remainingAllowance) : '—'}</Muted>
        </Row>
        {view?.account && (
          <>
            <Row style={{ justifyContent: 'space-between' }}>
              <Label>Lifetime spent</Label>
              <Muted>{formatUsd(view.account.lifetimeSpent)}</Muted>
            </Row>
            <Row style={{ justifyContent: 'space-between' }}>
              <Label>Payments</Label>
              <Muted>{view.account.paymentCount}</Muted>
            </Row>
          </>
        )}
      </Card>

      <Card>
        <Label>Top up (best-effort on devnet)</Label>
        <Field placeholder="USDC" keyboardType="decimal-pad" value={topUp} onChangeText={setTopUp} />
        <Button
          title="Top up"
          loading={busy}
          onPress={() => run(() => topUpVault(w.signer!, agentPk, Number(topUp)), 'Top up submitted')}
        />
      </Card>

      <Card>
        <Label>Edit policy</Label>
        <Field placeholder="Max per tx (USDC)" keyboardType="decimal-pad" value={perTx} onChangeText={setPerTx} />
        <Field placeholder="Daily limit (USDC, blank = none)" keyboardType="decimal-pad" value={daily} onChangeText={setDaily} />
        <Button
          title="Save policy"
          loading={busy}
          disabled={!view?.account}
          onPress={() =>
            run(async () => {
              const cur = view!.account!;
              const policy: Policy = {
                maxPerTx: usdcBase(Number(perTx)),
                maxSlippageBps: cur.maxSlippageBps,
                dailyLimit: daily ? usdcBase(Number(daily)) : null,
                merchantAllowlist: cur.merchantAllowlist,
                approvalThreshold: cur.approvalThreshold,
                expiry: cur.expiry,
              };
              await updateVaultPolicy(w.signer!, agentPk, policy);
            }, 'Policy updated')
          }
        />
      </Card>

      <Card>
        <Label>Danger zone</Label>
        <Muted>Revoke reclaims all funds to you and closes the vault.</Muted>
        <View style={{ height: theme.space(3) }} />
        <Button
          title="Revoke vault"
          variant="danger"
          loading={busy}
          onPress={() =>
            Alert.alert('Revoke vault?', 'Reclaims all funds and closes the vault.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Revoke',
                style: 'destructive',
                onPress: () =>
                  run(async () => {
                    await revokeVault(w.signer!, agentPk);
                    nav.goBack();
                  }, 'Vault revoked'),
              },
            ])
          }
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: theme.space(4), paddingTop: theme.space(6) },
});
