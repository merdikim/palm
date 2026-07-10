/**
 * Home — private balance (TEE-native, auth-gated) + core money actions.
 * Each action builds a tx via the API, signs it, and submits per `sendTo`
 * (base = devnet, ephemeral = TEE with token). Withdraw is labelled slower.
 */
import React, { useEffect, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useWallet } from '../context/WalletContext';
import {
  deposit,
  withdraw,
  privateTransfer,
  createRequest,
} from '../lib/actions';
import { RecipientNotOnboardedError } from '../lib/payments';
import { PublicKey } from '@solana/web3.js';
import {
  Button,
  Card,
  Field,
  Label,
  Muted,
  Row,
  ScreenTitle,
} from '../components/ui';
import { theme } from '../theme';
import { formatUsd, shortKey } from '../lib/format';

type Action = 'none' | 'deposit' | 'transfer' | 'withdraw' | 'request';

export function HomeScreen() {
  const w = useWallet();
  const [action, setAction] = useState<Action>('none');
  const [amount, setAmount] = useState('');
  const [to, setTo] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    w.refreshBalance().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reset = () => {
    setAction('none');
    setAmount('');
    setTo('');
    setMemo('');
  };

  const run = async (fn: () => Promise<unknown>, successMsg: string) => {
    if (!w.signer) return;
    setBusy(true);
    try {
      await fn();
      Alert.alert('Done', successMsg);
      reset();
      await w.refreshBalance();
    } catch (e) {
      if (e instanceof RecipientNotOnboardedError) {
        Alert.alert('Recipient not ready', e.message);
      } else {
        Alert.alert('Error', (e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={w.balanceLoading}
          onRefresh={() => w.refreshBalance()}
          tintColor={theme.colors.textDim}
        />
      }
    >
      <ScreenTitle>Home</ScreenTitle>

      <Card>
        <Label>Private balance</Label>
        <Text style={styles.balance}>
          {w.balance == null ? '—' : formatUsd(w.balance)}
        </Text>
        <Muted>
          {w.publicKey ? shortKey(w.publicKey) : ''} · read from the TEE rollup
        </Muted>
      </Card>

      {action === 'none' && (
        <Card>
          <Label>Actions</Label>
          <Button title="Deposit" onPress={() => setAction('deposit')} />
          <Button title="Private transfer" onPress={() => setAction('transfer')} />
          <Button
            title="Withdraw  (slower ~)"
            variant="ghost"
            onPress={() => setAction('withdraw')}
          />
          <Button title="Request payment" variant="ghost" onPress={() => setAction('request')} />
        </Card>
      )}

      {action === 'deposit' && (
        <Card>
          <Label>Deposit USDC (base → private rollup)</Label>
          <Field placeholder="Amount" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
          <Button
            title="Deposit"
            loading={busy}
            onPress={() => run(() => deposit(w.signer!, Number(amount)), 'Deposit submitted')}
          />
          <Button title="Cancel" variant="ghost" onPress={reset} />
        </Card>
      )}

      {action === 'transfer' && (
        <Card>
          <Label>Private transfer (rollup → rollup)</Label>
          <Field placeholder="Recipient pubkey" value={to} onChangeText={setTo} />
          <Field placeholder="Amount" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
          <Field placeholder="Memo (optional)" value={memo} onChangeText={setMemo} />
          <Muted>Recipient must have onboarded (made a first deposit) to receive.</Muted>
          <View style={{ height: theme.space(3) }} />
          <Button
            title="Send privately"
            loading={busy}
            onPress={() =>
              run(
                () => privateTransfer(w.signer!, to.trim(), Number(amount), memo || undefined),
                'Private transfer submitted',
              )
            }
          />
          <Button title="Cancel" variant="ghost" onPress={reset} />
        </Card>
      )}

      {action === 'withdraw' && (
        <Card>
          <Label>Withdraw (rollup → base) — slower ~</Label>
          <Muted>Undelegates back to the base layer; confirmation takes longer.</Muted>
          <View style={{ height: theme.space(3) }} />
          <Field placeholder="Amount" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
          <Button
            title="Withdraw"
            loading={busy}
            onPress={() => run(() => withdraw(w.signer!, Number(amount)), 'Withdraw submitted')}
          />
          <Button title="Cancel" variant="ghost" onPress={reset} />
        </Card>
      )}

      {action === 'request' && (
        <Card>
          <Label>Request payment from someone</Label>
          <Field placeholder="Payer pubkey" value={to} onChangeText={setTo} />
          <Field placeholder="Amount" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
          <Field placeholder="Memo (optional)" value={memo} onChangeText={setMemo} />
          <Button
            title="Create request"
            loading={busy}
            onPress={() =>
              run(async () => {
                const payer = new PublicKey(to.trim());
                await createRequest(w.signer!, payer, Number(amount), memo);
              }, 'Request created')
            }
          />
          <Button title="Cancel" variant="ghost" onPress={reset} />
        </Card>
      )}

      <Card>
        <Row style={{ justifyContent: 'space-between' }}>
          <Muted>Devnet only · TEE-native private balance</Muted>
          <Button title="Sign out" variant="ghost" onPress={() => w.signOut()} />
        </Row>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: theme.space(4), paddingTop: theme.space(6) },
  balance: {
    color: theme.colors.text,
    fontSize: 40,
    fontWeight: '800',
    marginVertical: theme.space(2),
  },
});
