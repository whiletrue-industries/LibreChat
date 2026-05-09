/* Admin Sanity */
import { QueryKeys, dataService } from 'librechat-data-provider';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { AdminSanityRunsResponse } from 'librechat-data-provider';

export const useAdminSanityQuery = (
  options?: UseQueryOptions<AdminSanityRunsResponse>,
) =>
  useQuery<AdminSanityRunsResponse>(
    [QueryKeys.adminSanity],
    () => dataService.getAdminSanity(),
    {
      staleTime: 60_000, // 1 min
      refetchOnWindowFocus: false,
      ...options,
    },
  );
