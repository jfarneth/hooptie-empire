import React, { useCallback, useEffect } from 'react';
import {
  claimDeal,
  counterOffer,
  declineProspect,
  releaseDeal,
  takeCashDeal,
  takeFinanceDeal,
} from '../../sim/actions';
import type { GameState } from '../../sim/types';
import { useGame } from '../../state/store';
import { DealSheet } from './DealSheet';

/**
 * The deal sheet, wired to the actions it offers — the same job `CarSheetHost`
 * does for the inventory sheet, and it exists for a sharper reason.
 *
 * OPENING A DEAL CLAIMS IT AND CLOSING IT RELEASES IT. A claimed prospect is
 * invisible to the sales desk, which is what stops staff closing a deal out from
 * under the slider the player is holding — and a second surface that opened the
 * sheet without claiming would hand that walk-up straight back to the desk mid
 * negotiation, silently, and only sometimes. That is not a bug anybody would
 * find by looking. Both actions are idempotent, so a re-render cannot double
 * fire them.
 *
 * The lot opens this by tapping the shopper standing at a car. The ageing report
 * opens it by tapping a row that has a buyer on it, which is the same rule the
 * lot already follows — a car with somebody at the bonnet is a deal, not a
 * listing, and you cannot honestly reprice a car with a customer looking at it.
 */
export function DealSheetHost({
  state,
  prospectId,
  onClose,
}: {
  state: GameState;
  prospectId: string | null;
  onClose: () => void;
}) {
  const apply = useGame((s) => s.apply);
  const prospect = prospectId
    ? (state.prospects.find((p) => p.id === prospectId) ?? null)
    : null;

  const close = useCallback(() => {
    if (prospectId) apply((s) => releaseDeal(s, prospectId));
    onClose();
  }, [apply, prospectId, onClose]);

  // A walk-up whose patience runs out mid-sheet should close it rather than
  // strand the player on a dead deal. No release here: there is nobody left to
  // release, and `releaseDeal` on a departed prospect is a no-op anyway.
  useEffect(() => {
    if (prospectId && !prospect) onClose();
  }, [prospectId, prospect, onClose]);

  return (
    <DealSheet
      state={state}
      prospect={prospect}
      onClose={close}
      onCash={() => {
        if (!prospect) return;
        apply((s) => takeCashDeal(s, prospect.id));
        onClose();
      }}
      onCounter={(price) => {
        if (!prospect) return;
        // Deliberately stays open: they may have come back with a better
        // number, and closing the sheet would hide the reply.
        apply((s) => counterOffer(s, prospect.id, price));
      }}
      onFinance={(push) => {
        if (!prospect) return;
        // Stays open when the push is refused, for the same reason a counter
        // does: they may have balked rather than left, and the cash side is
        // still on the table. Closing the sheet would hide that.
        apply((s) => takeFinanceDeal(s, prospect.id, push));
        onClose();
      }}
      onDecline={() => {
        if (!prospect) return;
        apply((s) => declineProspect(s, prospect.id));
        onClose();
      }}
    />
  );
}

/**
 * Claim a walk-up and open its sheet. Exported beside the host because the two
 * halves are one contract: every surface that opens a deal must claim it first.
 */
export function useOpenDeal(setProspectId: (id: string | null) => void) {
  const apply = useGame((s) => s.apply);
  return useCallback(
    (id: string) => {
      apply((s) => claimDeal(s, id));
      setProspectId(id);
    },
    [apply, setProspectId],
  );
}
