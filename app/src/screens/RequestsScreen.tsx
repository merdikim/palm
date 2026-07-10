/**
 * Requests — Pending / Accepted / Denied-Expired tabs. Pending splits into
 * "to me" (actionable), "from me" (waiting), and "agent approvals". Accept/deny
 * respond on the ER. Discovery uses the deterministic request-counter derivation
 * (spikes S4) plus the local registry. Push taps deep-link here with focusId.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PublicKey } from '@solana/web3.js';
import { useFocusEffect, useRoute, type RouteProp } from '@react-navigation/native';
import { useWallet } from '../context/WalletContext';
import {
  fetchAllRequests,
  respondToRequest,
  type RequestView,
} from '../lib/actions';
import { Button, Card, Label, Muted, Pill, Row, ScreenTitle } from '../components/ui';
import { theme } from '../theme';
import { formatUsd, shortKey } from '../lib/format';
import type { RequestsStackParamList } from '../navigation/types';

type Tab = 'pending' | 'accepted' | 'closed';

export function RequestsScreen() {
  const w = useWallet();
  const route = useRoute<RouteProp<RequestsStackParamList, 'RequestsList'>>();
  const focusId = route.params?.focusId;
  const [tab, setTab] = useState<Tab>('pending');
  const [items, setItems] = useState<RequestView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!w.signer) return;
    setLoading(true);
    try {
      setItems(await fetchAllRequests(w.signer));
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

  const me = w.publicKey;

  const groups = useMemo(() => {
    const withAccount = items.filter((i) => i.account);
    const pending = withAccount.filter((i) => i.account!.status === 'Pending');
    const accepted = withAccount.filter((i) => i.account!.status === 'Accepted');
    const closed = withAccount.filter(
      (i) => i.account!.status === 'Denied' || i.account!.status === 'Expired',
    );
    const toMe = pending.filter((i) => i.account!.payer.toBase58() === me && !i.account!.vault);
    const fromMe = pending.filter((i) => i.account!.requester.toBase58() === me);
    const agentApprovals = pending.filter((i) => !!i.account!.vault && i.account!.payer.toBase58() === me);
    return { toMe, fromMe, agentApprovals, accepted, closed };
  }, [items, me]);

  const respond = async (rv: RequestView, accept: boolean) => {
    if (!w.signer || !rv.account) return;
    const key = `${rv.entry.payer}:${rv.entry.requestId}`;
    setBusyId(key);
    try {
      await respondToRequest(w.signer, BigInt(rv.entry.requestId), accept, rv.account);
      Alert.alert('Done', accept ? 'Request accepted' : 'Request denied');
      await load();
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const renderCard = (rv: RequestView, actionable: boolean) => {
    const a = rv.account!;
    const key = `${rv.entry.payer}:${rv.entry.requestId}`;
    const highlight = focusId && rv.entry.requestId === focusId;
    return (
      <Card key={key} style={highlight ? { borderColor: theme.colors.primary } : undefined}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Text style={styles.amount}>{formatUsd(a.amountOut)}</Text>
          <Pill
            text={a.status.toLowerCase()}
            tone={a.status === 'Accepted' ? 'success' : a.status === 'Pending' ? 'warning' : 'danger'}
          />
        </Row>
        <Muted>
          {a.vault ? 'agent approval · ' : ''}
          from {shortKey(a.requester.toBase58())} → payer {shortKey(a.payer.toBase58())}
        </Muted>
        <Muted>id #{a.requestId.toString()} · expires {new Date(Number(a.expiresAt) * 1000).toLocaleString()}</Muted>
        {actionable && (
          <>
            <View style={{ height: theme.space(3) }} />
            <Button title="Accept & pay" loading={busyId === key} onPress={() => respond(rv, true)} />
            <Button title="Deny" variant="ghost" onPress={() => respond(rv, false)} />
          </>
        )}
      </Card>
    );
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={theme.colors.textDim} />}
    >
      <ScreenTitle>Requests</ScreenTitle>

      <Row style={styles.tabs}>
        {(['pending', 'accepted', 'closed'] as Tab[]).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[styles.tab, tab === t && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'closed' ? 'denied/expired' : t}
            </Text>
          </Pressable>
        ))}
      </Row>

      {tab === 'pending' && (
        <>
          <Label>To me (action needed)</Label>
          {groups.toMe.length === 0 ? <Muted>Nothing to act on.</Muted> : groups.toMe.map((r) => renderCard(r, true))}
          <View style={{ height: theme.space(4) }} />
          <Label>Agent approvals</Label>
          {groups.agentApprovals.length === 0 ? (
            <Muted>No pending agent approvals.</Muted>
          ) : (
            groups.agentApprovals.map((r) => renderCard(r, true))
          )}
          <View style={{ height: theme.space(4) }} />
          <Label>From me (waiting)</Label>
          {groups.fromMe.length === 0 ? <Muted>No outgoing requests.</Muted> : groups.fromMe.map((r) => renderCard(r, false))}
        </>
      )}

      {tab === 'accepted' && (
        <>
          {groups.accepted.length === 0 ? <Muted>None yet.</Muted> : groups.accepted.map((r) => renderCard(r, false))}
        </>
      )}

      {tab === 'closed' && (
        <>
          {groups.closed.length === 0 ? <Muted>None.</Muted> : groups.closed.map((r) => renderCard(r, false))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: theme.space(4), paddingTop: theme.space(6) },
  amount: { color: theme.colors.text, fontSize: 20, fontWeight: '700' },
  tabs: { marginBottom: theme.space(4), gap: theme.space(2) },
  tab: {
    paddingHorizontal: theme.space(3),
    paddingVertical: theme.space(2),
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  tabActive: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  tabText: { color: theme.colors.textDim, fontSize: 13, fontWeight: '600' },
  tabTextActive: { color: theme.colors.primaryText },
});
