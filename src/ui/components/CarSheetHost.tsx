import React, { useEffect } from 'react';
import {
  listForSale,
  repriceCar,
  sellToWholesaler,
  startRecon,
  unlist,
} from '../../sim/actions';
import type { GameState } from '../../sim/types';
import { useGame } from '../../state/store';
import { CarSheet } from './CarSheet';

/**
 * The inventory sheet, wired to the actions it offers.
 *
 * `CarSheet` is deliberately a dumb sheet — it takes five callbacks and knows
 * nothing about the store — and every screen that wants to open a car needs the
 * same five. This is that wiring, once, so a second surface cannot open the
 * sheet with a subtly different set: a "Wholesale it" button that sells the car
 * but leaves the sheet up over a car that no longer exists is the sort of bug
 * that only ever appears in the copy nobody remembered to update.
 *
 * The lot opens it by tapping a car. The ageing report opens it by tapping a
 * row, which is what turns that report from something you read into somewhere
 * you can act — the whole point of showing a player a car that has been sitting
 * for six weeks is that they can then do something about it without hunting for
 * it on the tarmac.
 */
export function CarSheetHost({
  state,
  carId,
  onClose,
}: {
  state: GameState;
  carId: string | null;
  onClose: () => void;
}) {
  const apply = useGame((s) => s.apply);
  const car = carId ? (state.cars.find((c) => c.id === carId) ?? null) : null;

  // A car that sells (or is repossessed out from under the sheet) while it is
  // open should close the sheet rather than strand the player on a dead car.
  useEffect(() => {
    if (carId && !car) onClose();
  }, [carId, car, onClose]);

  return (
    <CarSheet
      state={state}
      car={car}
      onClose={onClose}
      onRecon={() => car && apply((s) => startRecon(s, car.id))}
      onList={() => {
        if (!car) return;
        apply((s) => listForSale(s, car.id));
        onClose();
      }}
      onUnlist={() => car && apply((s) => unlist(s, car.id))}
      onReprice={(price) => car && apply((s) => repriceCar(s, car.id, price))}
      onWholesale={() => {
        if (!car) return;
        apply((s) => sellToWholesaler(s, car.id));
        // The car no longer exists, so the sheet has nothing left to show.
        onClose();
      }}
    />
  );
}
