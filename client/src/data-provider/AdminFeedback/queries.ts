/* Admin Feedback */
import { QueryKeys, MutationKeys, dataService } from 'librechat-data-provider';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type {
  AdminFeedbackDrillDownFilter,
  AdminFeedbackDrillDownResponse,
  AdminFeedbackOverview,
  AdminFeedbackOverviewFilter,
  AdminFeedbackPendingResponse,
} from 'librechat-data-provider';

export const useAdminFeedbackOverview = (filter: AdminFeedbackOverviewFilter) =>
  useQuery<AdminFeedbackOverview>(
    [QueryKeys.adminFeedbackOverview, filter],
    () => dataService.getAdminFeedbackOverview(filter),
    { staleTime: 5 * 60 * 1000 },
  );

export const useAdminFeedbackMessages = (
  filter: AdminFeedbackDrillDownFilter,
  enabled: boolean,
) =>
  useQuery<AdminFeedbackDrillDownResponse>(
    [QueryKeys.adminFeedbackMessages, filter],
    () => dataService.getAdminFeedbackMessages(filter),
    { enabled },
  );

export const useAdminFeedbackPending = () =>
  useQuery<AdminFeedbackPendingResponse>(
    [QueryKeys.adminFeedbackPending],
    () => dataService.getAdminFeedbackPending(),
  );

export const useApproveAdminFeedbackPending = () => {
  const queryClient = useQueryClient();
  return useMutation(
    [MutationKeys.approveAdminFeedbackPending],
    ({ id, rewrite }: { id: string; rewrite: boolean }) =>
      dataService.approveAdminFeedbackPending(id, rewrite),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.adminFeedbackOverview]);
        queryClient.invalidateQueries([QueryKeys.adminFeedbackPending]);
      },
    },
  );
};

export const useRejectAdminFeedbackPending = () => {
  const queryClient = useQueryClient();
  return useMutation(
    [MutationKeys.rejectAdminFeedbackPending],
    (id: string) => dataService.rejectAdminFeedbackPending(id),
    {
      onSuccess: () => {
        queryClient.invalidateQueries([QueryKeys.adminFeedbackPending]);
      },
    },
  );
};
