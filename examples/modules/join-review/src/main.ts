import { JOIN_REVIEW, type JoinOffer, type JoinReviewService, type ModuleInitializationV2 } from '@space-sim/game-api';

export function createHeadlessJoinReviewService(): JoinReviewService {
  return Object.freeze({
    async review(offer: JoinOffer, _address: string, signal: AbortSignal): Promise<boolean> {
      if (signal.aborted) return false;
      const hasUntrustedCode = offer.packages.some(pkg => pkg.containsCode && pkg.tier !== 'platform');
      return !hasUntrustedCode;
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  context.provide(JOIN_REVIEW, createHeadlessJoinReviewService());
}
