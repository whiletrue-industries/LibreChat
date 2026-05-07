/* Admin Prompts */
import { QueryKeys, MutationKeys, dataService } from 'librechat-data-provider';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import type {
  AdminPromptAgentsResponse,
  AdminPromptSectionsResponse,
  AdminPromptVersionsResponse,
  AdminPromptSaveDraftInput,
  AdminPromptSaveDraftResponse,
  AdminPromptPublishInput,
  AdminPromptPublishResponse,
  AdminPromptPreviewInput,
  AdminPromptPreviewResponse,
  AdminPromptRestoreInput,
  AdminPromptRestoreResponse,
  AdminPromptTestQuestionsResponse,
  AdminPromptTestQuestionPutInput,
  AdminPromptUsage,
  AdminPromptJoinedResponse,
  AdminPromptJoinedDraftInput,
  AdminPromptJoinedDraftResponse,
  AdminPromptJoinedPublishInput,
  AdminPromptJoinedPublishResponse,
  AdminPromptSnapshotsResponse,
  AdminPromptSnapshotRestoreResponse,
} from 'librechat-data-provider';

export const useAdminPromptAgents = () =>
  useQuery<AdminPromptAgentsResponse>(
    [QueryKeys.adminPromptsAgents],
    () => dataService.getAdminPromptsAgents(),
    { staleTime: 60 * 1000 },
  );

export const useAdminPromptSections = (agentType: string) =>
  useQuery<AdminPromptSectionsResponse>(
    [QueryKeys.adminPromptsSections, agentType],
    () => dataService.getAdminPromptsSections(agentType),
    { enabled: Boolean(agentType) },
  );

export const useAdminPromptVersions = (agentType: string, sectionKey: string) =>
  useQuery<AdminPromptVersionsResponse>(
    [QueryKeys.adminPromptsVersions, agentType, sectionKey],
    () => dataService.getAdminPromptsVersions(agentType, sectionKey),
    { enabled: Boolean(agentType && sectionKey) },
  );

export const useSaveAdminPromptDraft = () => {
  const qc = useQueryClient();
  return useMutation<
    AdminPromptSaveDraftResponse,
    unknown,
    { agentType: string; sectionKey: string; input: AdminPromptSaveDraftInput }
  >(
    [MutationKeys.saveAdminPromptDraft],
    ({ agentType, sectionKey, input }) =>
      dataService.saveAdminPromptDraft(agentType, sectionKey, input),
    {
      onSuccess: (_data, vars) => {
        qc.invalidateQueries([QueryKeys.adminPromptsSections, vars.agentType]);
        qc.invalidateQueries([
          QueryKeys.adminPromptsVersions,
          vars.agentType,
          vars.sectionKey,
        ]);
      },
    },
  );
};

export const usePublishAdminPrompt = () => {
  const qc = useQueryClient();
  return useMutation<
    AdminPromptPublishResponse,
    unknown,
    { agentType: string; sectionKey: string; input: AdminPromptPublishInput }
  >(
    [MutationKeys.publishAdminPrompt],
    ({ agentType, sectionKey, input }) =>
      dataService.publishAdminPrompt(agentType, sectionKey, input),
    {
      onSuccess: (_data, vars) => {
        qc.invalidateQueries([QueryKeys.adminPromptsAgents]);
        qc.invalidateQueries([QueryKeys.adminPromptsSections, vars.agentType]);
        qc.invalidateQueries([
          QueryKeys.adminPromptsVersions,
          vars.agentType,
          vars.sectionKey,
        ]);
      },
    },
  );
};

export const usePreviewAdminPrompt = () =>
  useMutation<
    AdminPromptPreviewResponse,
    unknown,
    { agentType: string; sectionKey: string; input: AdminPromptPreviewInput }
  >(
    [MutationKeys.previewAdminPrompt],
    ({ agentType, sectionKey, input }) =>
      dataService.previewAdminPrompt(agentType, sectionKey, input),
  );

export const useRestoreAdminPrompt = () => {
  const qc = useQueryClient();
  return useMutation<
    AdminPromptRestoreResponse,
    unknown,
    { agentType: string; sectionKey: string; input: AdminPromptRestoreInput }
  >(
    [MutationKeys.restoreAdminPrompt],
    ({ agentType, sectionKey, input }) =>
      dataService.restoreAdminPrompt(agentType, sectionKey, input),
    {
      onSuccess: (_data, vars) => {
        qc.invalidateQueries([QueryKeys.adminPromptsSections, vars.agentType]);
        qc.invalidateQueries([
          QueryKeys.adminPromptsVersions,
          vars.agentType,
          vars.sectionKey,
        ]);
      },
    },
  );
};

export const useAdminPromptTestQuestions = (agentType: string) =>
  useQuery<AdminPromptTestQuestionsResponse>(
    [QueryKeys.adminPromptTestQuestions, agentType],
    () => dataService.getAdminPromptTestQuestions(agentType),
    { enabled: Boolean(agentType) },
  );

export const usePutAdminPromptTestQuestions = () => {
  const qc = useQueryClient();
  return useMutation<
    { ok: true },
    unknown,
    { agentType: string; input: AdminPromptTestQuestionPutInput }
  >(
    [MutationKeys.putAdminPromptTestQuestions],
    ({ agentType, input }) =>
      dataService.putAdminPromptTestQuestions(agentType, input),
    {
      onSuccess: (_data, vars) => {
        qc.invalidateQueries([QueryKeys.adminPromptTestQuestions, vars.agentType]);
      },
    },
  );
};

export const useAdminPromptVersionUsage = (
  agentType: string,
  sectionKey: string,
  versionId: string | null,
) =>
  useQuery<AdminPromptUsage>(
    [QueryKeys.adminPromptVersionUsage, agentType, sectionKey, versionId],
    () =>
      dataService.getAdminPromptVersionUsage(
        agentType,
        sectionKey,
        versionId as string,
      ),
    { enabled: Boolean(versionId), staleTime: 5 * 60 * 1000 },
  );

export const useJoinedPrompt = (agentType: string) =>
  useQuery<AdminPromptJoinedResponse>(
    [QueryKeys.adminPromptsJoined, agentType],
    () => dataService.getAdminPromptJoined(agentType),
    { enabled: Boolean(agentType) },
  );

export const useSaveJoinedDraft = (agentType: string) => {
  const qc = useQueryClient();
  return useMutation<
    AdminPromptJoinedDraftResponse,
    unknown,
    AdminPromptJoinedDraftInput
  >(
    [MutationKeys.saveAdminPromptJoinedDraft, agentType],
    (input) => dataService.saveAdminPromptJoinedDraft(agentType, input),
    {
      onSuccess: () => {
        qc.invalidateQueries([QueryKeys.adminPromptsJoined, agentType]);
        qc.invalidateQueries([QueryKeys.adminPromptsSections, agentType]);
        qc.invalidateQueries([QueryKeys.adminPromptsAgents]);
      },
    },
  );
};

export const usePublishJoinedDraft = (agentType: string) => {
  const qc = useQueryClient();
  return useMutation<
    AdminPromptJoinedPublishResponse,
    unknown,
    AdminPromptJoinedPublishInput
  >(
    [MutationKeys.publishAdminPromptJoined, agentType],
    (input) => dataService.publishAdminPromptJoined(agentType, input),
    {
      onSuccess: () => {
        qc.invalidateQueries([QueryKeys.adminPromptsJoined, agentType]);
        qc.invalidateQueries([QueryKeys.adminPromptsSections, agentType]);
        qc.invalidateQueries([QueryKeys.adminPromptsSnapshots, agentType]);
        qc.invalidateQueries([QueryKeys.adminPromptsAgents]);
      },
    },
  );
};

export const useSnapshots = (agentType: string) =>
  useQuery<AdminPromptSnapshotsResponse>(
    [QueryKeys.adminPromptsSnapshots, agentType],
    () => dataService.getAdminPromptSnapshots(agentType),
    { enabled: Boolean(agentType) },
  );

export const useRestoreSnapshot = (agentType: string) => {
  const qc = useQueryClient();
  return useMutation<
    AdminPromptSnapshotRestoreResponse,
    unknown,
    { minute: string }
  >(
    [MutationKeys.restoreAdminPromptSnapshot, agentType],
    ({ minute }) => dataService.restoreAdminPromptSnapshot(agentType, minute),
    {
      onSuccess: () => {
        qc.invalidateQueries([QueryKeys.adminPromptsJoined, agentType]);
        qc.invalidateQueries([QueryKeys.adminPromptsSections, agentType]);
        qc.invalidateQueries([QueryKeys.adminPromptsSnapshots, agentType]);
      },
    },
  );
};
