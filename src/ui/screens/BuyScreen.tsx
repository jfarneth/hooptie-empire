import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { buyListing } from '../../sim/actions';
import { retailValue, wholesaleValue } from '../../sim/economy';
import { getModel } from '../../sim/models';
import { carCapacity } from '../../sim/upgrades';
import type { GameState, Listing } from '../../sim/types';
import { useGame } from '../../state/store';
import { duration, money, theme } from '../theme';
import { CarSvg } from '../components/CarSvg';
import { Chip, EmptyState, Label, Row } from '../components/ui';

/**
 * The sourcing feed. Deals rotate off after a while, so this is the screen that
 * rewards checking in — and the throughput here is the real ceiling on the whole
 * business, which is why auction contacts matter more than they look.
 */
export function BuyScreen({ state }: { state: GameState }) {
  const apply = useGame((s) => s.apply);
  const held = state.cars.filter((c) => c.status !== 'sold').length;
  const capacity = carCapacity(state);
  const full = held >= capacity;

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Label>What's for sale</Label>
        {full ? <Chip text="LOT FULL" color={theme.colors.danger} /> : null}
      </Row>

      {state.listings.length === 0 ? (
        <EmptyState
          title="Nothing on the wire"
          hint="Listings show up on their own. Auction contacts make them show up faster."
        />
      ) : (
        state.listings.map((listing) => (
          <ListingRow
            key={listing.id}
            listing={listing}
            state={state}
            disabled={full || state.cash < listing.price}
            onBuy={() => apply((s) => buyListing(s, listing.id))}
          />
        ))
      )}
    </ScrollView>
  );
}

function ListingRow({
  listing,
  state,
  disabled,
  onBuy,
}: {
  listing: Listing;
  state: GameState;
  disabled: boolean;
  onBuy: () => void;
}) {
  const model = getModel(listing.car.modelId);
  const wholesale = wholesaleValue(listing.car);
  const retail = retailValue(listing.car);
  const underWholesale = listing.price <= wholesale;
  const spread = retail - listing.price;
  const expiresIn = listing.expiresAt - state.t;

  return (
    <Pressable
      onPress={disabled ? undefined : onBuy}
      style={({ pressed }) => [
        styles.row,
        underWholesale && styles.rowDeal,
        disabled && styles.rowDisabled,
        pressed && !disabled && { borderColor: theme.colors.accent },
      ]}
    >
      <View style={styles.thumb}>
        <CarSvg
          bodyStyle={model.bodyStyle}
          colorIndex={listing.car.colorIndex}
          condition={listing.car.condition}
          width={96}
        />
      </View>

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {model.name}
        </Text>
        <Text style={styles.meta}>
          {listing.car.mileage.toLocaleString('en-US')} mi · {Math.round(listing.car.condition * 100)}%
          {' · '}
          {listing.source}
        </Text>
        <Row gap={6} style={{ marginTop: 4 }}>
          {underWholesale ? <Chip text="UNDER WHOLESALE" color={theme.colors.money} /> : null}
          <Text style={styles.expiry}>gone in {duration(expiresIn)}</Text>
        </Row>
      </View>

      <View style={styles.priceCol}>
        <Text style={styles.price}>{money(listing.price)}</Text>
        <Text style={[styles.spread, { color: spread > 0 ? theme.colors.money : theme.colors.danger }]}>
          {spread > 0 ? '+' : ''}
          {money(spread)}
        </Text>
        <Text style={styles.spreadLabel}>vs retail</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 8, paddingBottom: 32 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: 10,
  },
  rowDeal: { borderColor: theme.colors.moneyDim },
  rowDisabled: { opacity: 0.45 },
  thumb: { width: 96, alignItems: 'center' },
  info: { flex: 1, gap: 1 },
  name: { color: theme.colors.text, fontSize: 14, fontWeight: '700' },
  meta: { color: theme.colors.textDim, fontSize: 11 },
  expiry: { color: theme.colors.textFaint, fontSize: 10 },
  priceCol: { alignItems: 'flex-end', gap: 1 },
  price: {
    color: theme.colors.text,
    fontSize: 16,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  spread: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  spreadLabel: { color: theme.colors.textFaint, fontSize: 9 },
});
