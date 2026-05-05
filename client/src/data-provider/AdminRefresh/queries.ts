import { QueryKeys, dataService } from 'librechat-data-provider';
import {
  useQuery,
  useMutation,
  useQueryClient,
  type UseQueryOptions,
  type UseMutationOptions,
} from '@tanstack/react-query';
import type {
  AdminRefreshAckResponse,
  AdminRefreshStatusResponse,
} from 'librechat-data-provider';

export const useAdminRefreshStatusQuery = (
  options?: UseQueryOptions<AdminRefreshStatusResponse>,
) =>
  useQuery<AdminRefreshStatusResponse>(
    [QueryKeys.adminRefreshStatus],
    () => dataService.getAdminRefreshStatus(),
    {
      refetchInterval: (data) => (data?.status === 'running' ? 3000 : false),
      staleTime: 0,
      ...options,
    },
  );

export const useAdminRefreshTriggerMutation = (
  options?: UseMutationOptions<AdminRefreshAckResponse, Error, void>,
) => {
  const queryClient = useQueryClient();
  return useMutation<AdminRefreshAckResponse, Error, void>(
    () => dataService.triggerAdminRefresh(),
    {
      onSuccess: (data, vars, ctx) => {
        queryClient.invalidateQueries([QueryKeys.adminRefreshStatus]);
        options?.onSuccess?.(data, vars, ctx);
      },
      ...options,
    },
  );
};
