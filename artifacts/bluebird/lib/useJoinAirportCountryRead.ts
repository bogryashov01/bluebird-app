import { useQuery } from '@tanstack/react-query';
import {
  presentAirportCountryRead,
  type AirportCountryRead,
} from '@/lib/joinFlightPresentation';
import {
  fetchProductionAirports,
  normalizeAirportCodes,
  productionReadRetryDelay,
  shouldRetryProductionRead,
} from '@/lib/productionFlights';

/** Loads both airport countries before the international notice is chosen. */
export function useJoinAirportCountryRead(
  originCode: string | null,
  destinationCode: string | null,
): AirportCountryRead {
  const codes = originCode && destinationCode
    ? normalizeAirportCodes([originCode, destinationCode])
    : [];
  const query = useQuery({
    queryKey: ['production-airports', codes],
    queryFn: ({ signal }) => fetchProductionAirports(codes, { signal }),
    enabled: codes.length > 0,
    retry: shouldRetryProductionRead,
    retryDelay: productionReadRetryDelay,
  });

  return presentAirportCountryRead({
    originCode,
    destinationCode,
    isPending: query.isPending,
    isError: query.isError,
    records: query.data,
  });
}
