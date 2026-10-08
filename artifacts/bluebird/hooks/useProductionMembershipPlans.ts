import { useQuery } from '@tanstack/react-query';
import { fetchProductionMembershipPlans } from '@/lib/productionMembershipPlans';

export function useProductionMembershipPlans() {
  return useQuery({
    queryKey: ['production-membership-plans'],
    queryFn: ({ signal }) => fetchProductionMembershipPlans({ signal }),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
