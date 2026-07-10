/**
 * Create vault — pick/generate an agent key, choose a funding amount that
 * selects a tiered policy preset, then create the vault on-chain (owner-signed).
 * Funding itself is a separate top-up step (best-effort on devnet, see actions).
 */
import React, { useMemo, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { useNavigation } from '@react-navigation/native';
import { useWallet } from '../context/WalletContext';
import { createVault } from '../lib/actions';
import { presetPolicy, tierForFunding, tierSummary, policySummary } from '../lib/policy';
import { Button, Card, Field, Label, Muted, ScreenTitle } from '../components/ui';
import { theme } from '../theme';
import { shortKey } from '../lib/format';

export function CreateVaultScreen() {
  const w = useWallet();
  const nav = useNavigation();
  const [agentKey, setAgentKey] = useState('');
  const [generatedSecret, setGeneratedSecret] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [funding, setFunding] = useState('25');
  const [busy, setBusy] = useState(false);

  const fundingNum = Number(funding) || 0;
  const tier = tierForFunding(fundingNum);
  const policy = useMemo(() => presetPolicy({ fundingDollars: fundingNum }), [fundingNum]);

  const generateAgent = () => {
    const kp = Keypair.generate();
    setAgentKey(kp.publicKey.toBase58());
    setGeneratedSecret(bs58.encode(kp.secretKey));
  };

  const submit = async () => {
    if (!w.signer) return;
    let agent: PublicKey;
    try {
      agent = new PublicKey(agentKey.trim());
    } catch {
      Alert.alert('Invalid agent', 'Enter or generate a valid agent pubkey.');
      return;
    }
    setBusy(true);
    try {
      await createVault(w.signer, agent, policy, label || undefined);
      Alert.alert('Vault created', 'Fund it via "Top up" on the agent detail screen.');
      nav.goBack();
    } catch (e) {
      Alert.alert('Error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ScreenTitle>New agent vault</ScreenTitle>

      <Card>
        <Label>Agent key</Label>
        <Field placeholder="Agent pubkey" value={agentKey} onChangeText={setAgentKey} />
        <Button title="Generate agent key" variant="ghost" onPress={generateAgent} />
        {generatedSecret && (
          <Muted>
            Save this agent secret to wire your automation (shown once):
            {'\n'}
            {generatedSecret}
          </Muted>
        )}
      </Card>

      <Card>
        <Label>Label (optional)</Label>
        <Field placeholder="e.g. Shopping bot" value={label} onChangeText={setLabel} />
      </Card>

      <Card>
        <Label>Funding amount (selects policy tier)</Label>
        <Field placeholder="USDC" keyboardType="decimal-pad" value={funding} onChangeText={setFunding} />
        <Muted>{tierSummary(tier)}</Muted>
        <View style={{ height: theme.space(2) }} />
        <Label>Policy preset (editable defaults)</Label>
        <Muted>{policySummary(policy)}</Muted>
      </Card>

      <Button title="Create vault" loading={busy} onPress={submit} disabled={!agentKey} />
      <Muted>Vault seeds: ["vault", owner {shortKey(w.publicKey ?? '')}, agent]</Muted>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.bg },
  content: { padding: theme.space(4), paddingTop: theme.space(6) },
});
