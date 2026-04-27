/* Admin Sources */
import { QueryKeys, dataService } from 'librechat-data-provider';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type {
  AdminSourcesResponse,
  AdminSourceResponse,
} from 'librechat-data-provider';

export const useAdminSourcesQuery = (
  options?: UseQueryOptions<AdminSourcesResponse>,
) =>
  useQuery<AdminSourcesResponse>(
    [QueryKeys.adminSources],
    () => dataService.getAdminSources(),
    { staleTime: 30_000, ...options },
  );

export const useAdminSourceQuery = (
  context: string,
  options?: UseQueryOptions<AdminSourceResponse>,
) =>
  useQuery<AdminSourceResponse>(
    [QueryKeys.adminSource, context],
    () => dataService.getAdminSource(context),
    { staleTime: 30_000, enabled: Boolean(context), ...options },
  );
