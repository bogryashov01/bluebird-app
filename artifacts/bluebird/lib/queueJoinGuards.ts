export interface ProductionQueueJoinEligibility {
  isAlreadyInQueue: boolean;
  flightPublished: boolean;
  profileComplete: boolean;
  activeMember: boolean;
}

export function canJoinProductionQueue(input: ProductionQueueJoinEligibility): boolean {
  return !input.isAlreadyInQueue &&
    input.flightPublished &&
    input.profileComplete &&
    input.activeMember;
}

export function canStartQueueJoin(isLocked: boolean, isBusy: boolean): boolean {
  return !isLocked && !isBusy;
}
