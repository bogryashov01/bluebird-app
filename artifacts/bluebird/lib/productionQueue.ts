import type {
  createAuthenticatedProductionApiClient,
  ProductionEmptyLeg,
  ProductionPublicQueueEntry,
  ProductionQueueEntry,
  ProductionQueueStatus,
  ProductionRequestOptions,
  JoinProductionQueueRequest,
} from './productionAuthApi';

export type ProductionQueueViewer =
  | { status: 'not-in-queue' }
  | { status: 'in-queue'; position: number };

export interface ProductionQueueRead {
  entries: ProductionPublicQueueEntry[];
  viewer: ProductionQueueViewer;
}

export class ProductionQueueContractError extends Error {
  constructor(
    message: string,
    readonly code: 'ambiguous_viewer' | 'invalid_transition' | 'credit_required' | 'confirmation_required',
  ) {
    super(message);
    this.name = 'ProductionQueueContractError';
  }
}

export function deriveProductionQueueRead(
  entries: ProductionPublicQueueEntry[],
): ProductionQueueRead {
  const viewerEntries = entries.filter((entry) => entry.isViewer);
  if (viewerEntries.length > 1) {
    throw new ProductionQueueContractError(
      'The Main API identified the viewer in more than one queue position.',
      'ambiguous_viewer',
    );
  }

  if (viewerEntries.length === 0) return { entries, viewer: { status: 'not-in-queue' } };

  const position = viewerEntries[0].position;
  if (!Number.isSafeInteger(position) || position < 1) {
    throw new ProductionQueueContractError(
      'The Main API returned an invalid position for the viewer.',
      'invalid_transition',
    );
  }
  return { entries, viewer: { status: 'in-queue', position } };
}

function assertLegId(emptyLegId: number, responseLegId: number): void {
  if (!Number.isSafeInteger(emptyLegId) || emptyLegId < 1 || responseLegId !== emptyLegId) {
    throw new ProductionQueueContractError(
      'The Main API queue response did not match the requested flight.',
      'invalid_transition',
    );
  }
}

export function validateProductionQueueJoin(
  emptyLegId: number,
  entry: ProductionQueueEntry,
): ProductionQueueEntry {
  assertLegId(emptyLegId, entry.emptyLegId);
  if (entry.userInQueue !== true || !Number.isSafeInteger(entry.position) || entry.position < 1) {
    throw new ProductionQueueContractError(
      'The Main API did not confirm a valid queue position.',
      'invalid_transition',
    );
  }
  return entry;
}

export function validateProductionQueueLeave(
  emptyLegId: number,
  status: ProductionQueueStatus,
): ProductionQueueStatus {
  assertLegId(emptyLegId, status.emptyLegId);
  if (status.userInQueue !== false) {
    throw new ProductionQueueContractError(
      'The Main API did not confirm that you left the queue.',
      'invalid_transition',
    );
  }
  return status;
}

export function validateProductionSkipLine(
  emptyLegId: number,
  flight: ProductionEmptyLeg,
): ProductionEmptyLeg {
  assertLegId(emptyLegId, flight.id);
  if (flight.viewerIsEffectiveWinner !== true) {
    throw new ProductionQueueContractError(
      'The Main API did not confirm Skip the Line for this flight.',
      'invalid_transition',
    );
  }
  return flight;
}

type AuthenticatedQueueApi = Pick<
  ReturnType<typeof createAuthenticatedProductionApiClient>,
  'getEmptyLegQueue' | 'joinEmptyLegQueue' | 'leaveEmptyLegQueue' | 'skipLine'
>;

/** Queue-only adapter. It has no access to local/demo queue or payment methods. */
export function createProductionQueueActions(api: AuthenticatedQueueApi) {
  return {
    async read(
      emptyLegId: number,
      requestOptions?: ProductionRequestOptions,
    ): Promise<ProductionQueueRead> {
      const entries = await api.getEmptyLegQueue(emptyLegId, requestOptions);
      return deriveProductionQueueRead(entries);
    },
    async join(
      emptyLegId: number,
      data?: JoinProductionQueueRequest,
    ): Promise<ProductionQueueEntry> {
      const entry = await api.joinEmptyLegQueue(emptyLegId, data);
      return validateProductionQueueJoin(emptyLegId, entry);
    },
    async leave(emptyLegId: number): Promise<ProductionQueueStatus> {
      const status = await api.leaveEmptyLegQueue(emptyLegId);
      return validateProductionQueueLeave(emptyLegId, status);
    },
    async skipLine(
      emptyLegId: number,
      existingCreditCount: number,
      confirmed: boolean,
    ): Promise<ProductionEmptyLeg> {
      if (confirmed !== true) {
        throw new ProductionQueueContractError(
          'Explicit confirmation is required before using a Skip the Line credit.',
          'confirmation_required',
        );
      }
      if (!Number.isSafeInteger(existingCreditCount) || existingCreditCount < 1) {
        throw new ProductionQueueContractError(
          'An existing Skip the Line credit is required. No purchase was made.',
          'credit_required',
        );
      }
      const flight = await api.skipLine(emptyLegId, { useCredit: true });
      return validateProductionSkipLine(emptyLegId, flight);
    },
  };
}
