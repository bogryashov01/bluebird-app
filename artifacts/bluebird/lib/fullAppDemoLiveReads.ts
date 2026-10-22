import {
  fetchProductionFlight,
  fetchProductionFlights,
  fetchProductionJson,
  mapProductionFlight,
  parseProductionFlightId,
  ProductionReadCancelledError,
  ProductionReadSchemaError,
  type FlightView,
  type ReadRequestOptions,
} from './productionFlights';
import type { ProductionPublicQueueEntry } from './productionAuthApi';
import localFlightFixtures from '../fixtures/full-app-demo-flights.json';

export type FullAppDemoPublicQueueEntry = Omit<ProductionPublicQueueEntry, 'isViewer'>;

const PUBLIC_QUEUE_CONTRACT_KEYS = [
  'position',
  'initials',
  'tier',
  'hasLineSkip',
  'isViewer',
] as const satisfies readonly (keyof ProductionPublicQueueEntry)[];

function parsePublicQueue(value: unknown): FullAppDemoPublicQueueEntry[] {
  if (!Array.isArray(value)) {
    throw new Error('Queue response must be a public queue array.');
  }
  return value.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Queue entry ${index + 1} is not an object.`);
    }
    const raw = item as Record<string, unknown>;
    const keys = Object.keys(raw);
    if (
      keys.length !== PUBLIC_QUEUE_CONTRACT_KEYS.length ||
      PUBLIC_QUEUE_CONTRACT_KEYS.some((key) => !Object.prototype.hasOwnProperty.call(raw, key)) ||
      keys.some((key) => !(PUBLIC_QUEUE_CONTRACT_KEYS as readonly string[]).includes(key))
    ) {
      throw new Error(`Queue entry ${index + 1} does not match the established public queue contract.`);
    }
    if (typeof raw.position !== 'number' ||
        !Number.isSafeInteger(raw.position) ||
        raw.position < 1) {
      throw new Error(`Queue entry ${index + 1} has an invalid position.`);
    }
    if (typeof raw.initials !== 'string' || !['free', 'base', 'plus'].includes(String(raw.tier)) ||
        typeof raw.hasLineSkip !== 'boolean' || typeof raw.isViewer !== 'boolean') {
      throw new Error(`Queue entry ${index + 1} does not match the established public queue contract.`);
    }

    // isViewer is validated because it is part of the API contract, but is
    // intentionally never returned: the local fixture is not a real viewer.
    return {
      position: raw.position as number,
      initials: raw.initials,
      tier: raw.tier as FullAppDemoPublicQueueEntry['tier'],
      hasLineSkip: raw.hasLineSkip,
    };
  });
}

export function fetchFullAppDemoFlights(options: ReadRequestOptions = {}): Promise<FlightView[]> {
  return fetchProductionFlights(options).then((flights) => {
    if (flights.length > 0) return flights;
    return getLocalDemoFlights();
  }).catch((error: unknown) => {
    if (options.signal?.aborted || error instanceof ProductionReadCancelledError) throw error;
    return getLocalDemoFlights();
  });
}

export async function fetchFullAppDemoFlight(
  id: number,
  options: ReadRequestOptions = {},
): Promise<FlightView> {
  try {
    return await fetchProductionFlight(id, options);
  } catch (error) {
    if (options.signal?.aborted || error instanceof ProductionReadCancelledError) throw error;
    const fixture = getLocalDemoFlights().find((flight) => flight.id === String(id));
    if (fixture) return fixture;
    throw error;
  }
}

function getLocalDemoFlights(): FlightView[] {
  return localFlightFixtures.map((flight) => ({
    ...mapProductionFlight(flight),
    source: 'local',
  }));
}

export function fetchFullAppDemoQueue(
  flight: FlightView,
  options: ReadRequestOptions = {},
): Promise<FullAppDemoPublicQueueEntry[]> {
  if (flight.source !== 'production') {
    throw new Error('A live Production flight is required for its public queue read.');
  }
  const id = parseProductionFlightId(flight.id);
  if (parseProductionFlightId(id) === null) {
    throw new Error('A positive numeric production flight ID is required.');
  }
  return fetchProductionJson(`/empty-legs/${id}/queue`, options).then((value) => {
    try {
      return parsePublicQueue(value);
    } catch {
      throw new ProductionReadSchemaError('public queue');
    }
  });
}
