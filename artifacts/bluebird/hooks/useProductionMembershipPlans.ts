import { useQuery } from '@tanstack/react-query';
import { fetchProductionMembershipPlans } from '@/lib/productionMembershipPlans';
import {
  productionReadRetryDelay,
  shouldRetryProductionRead,
} from '@/lib/productionFlights';

export function useProductionMembershipPlans() {
  return useQuery({
    queryKey: ['production-membership-plans'],
    queryFn: ({ signal }) => fetchProductionMembershipPlans({ signal }),
    staleTime: 5 * 60 * 1000,
    retry: shouldRetryProductionRead,
    retryDelay: productionReadRetryDelay,
  });
}
