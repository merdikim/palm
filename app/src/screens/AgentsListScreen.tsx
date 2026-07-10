/**
 * Agents — list vaults created from this wallet (local registry + on-chain
 * fetch). Shows remaining allowance, lifetime spent, payment count, expiry, and
 * a policy summary. Entry point to create a new vault.
 */
import React, { useCallback, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useWallet } from '../context/WalletContext';
import { fetchAllVaults, type VaultView } from '../lib/actions';
import { policySummary } from '../lib/policy';
import { Button, Card, Label, Muted, Pill, Row, ScreenTitle } from '../components/ui';
import { theme } from '../theme';
import { formatUsd, shortKey } from '../lib/format';
import type { AgentsStackParamList } from '../navigation/types';

export function AgentsListScreen() {
  const w = useWallet();
  const nav = useNavigation<NativeStackNavigationProp<AgentsStackParamList>>();
  const [vaults, setVaults] = useState<VaultView[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!w.signer) return;
    setLoading(true);
    try {
      setVaults(await fetchAllVaults(w.signer));
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [w.signer]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.colors.textDim} />
      }
    >
      <ScreenTitle>Agents</ScreenTitle>
      <Button title="+ Create agent vault" onPress={() => nav.navigate('CreateVault')} />

      {vaults.length === 0 && !loading && (
        <Card>
          <Muted>No agent vaults yet. Create one to give an automation a private, capped allowance.</Muted>
        </Card>
      )}

      {vaults.map((v) => {
        const acct = v.account;
        return (
          <Card key={v.agent}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Text style={styles.agentName}>{v.label ?? shortKey(v.agent)}</Text>
              {acct ? <Pill text="active" tone="success" /> : <Pill text="pending" tone="warning" />}
            </Row>
            <Muted>agent {shortKey(v.agent)}</Muted>
            <View style={{ height: theme.space(3) }} />
            <Row style={{ justifyContent: 'space-between' }}>
              <Label>Remaining allowance</Label>
              <Text style={styles.value}>{formatUsd(v.remainingAllowance)}</Text>
            </Row>
            {acct && (
              <>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Label>Lifetime spent</Label>
                  <Text style={styles.value}>{formatUsd(acct.lifetimeSpent)}</Text>
                </Row>
                <Row style={{ justifyContent: 'space-between' }}>
                  <Label>Payments</Label>
                  <Text style={styles.value}>{acct.paymentCount}</Text>
                </Row>
                {acct.expiry != null && (
                  <Row style={{ justifyContent: 'space-between' }}>
                    <Label>Expires</Label>
                    <Text style={styles.value}>
                      {new Date(Number(acct.expiry) * 1000).toLocaleDateString()}
                    </Text>
                  </Row>
                )}
                <View style={{ height: theme.space(2) }} />
                <Muted>
                  {policySummary({
                    maxPerTx: acct.maxPerTx,
                    maxSlippageBps: acct.maxSlippageBps,
                    dailyLimit: acct.dailyLimit,
                    merchantAllowlist: acct.merchantAllowlist,
                    approvalThreshold: acct.approvalThreshold,
                    expiry: acct.expiry,
                  })}
                </Muted>
              </>
            )}
            <View style={{ height: theme.space(3) }} />
            <Button title="Manage" variant="ghost" onPress={() => nav.navigate('AgentDetail', { agent: v.agent })} />
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: theme.space(4), paddingTop: theme.space(6) },
  agentName: { color: theme.colors.text, fontSize: 18, fontWeight: '700' },
  value: { color: theme.colors.text, fontSize: 15, fontWeight: '600' },
});
