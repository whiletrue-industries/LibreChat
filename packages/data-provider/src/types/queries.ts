import type { InfiniteData } from '@tanstack/react-query';
import type * as p from '../accessPermissions';
import type * as a from '../types/agents';
import type * as s from '../schemas';
import type * as t from '../types';

export type Conversation = {
  id: string;
  createdAt: number;
  participants: string[];
  lastMessage: string;
  conversations: s.TConversation[];
};

export type ConversationListParams = {
  cursor?: string;
  isArchived?: boolean;
  sortBy?: 'title' | 'createdAt' | 'updatedAt';
  sortDirection?: 'asc' | 'desc';
  tags?: string[];
  search?: string;
};

export type MinimalConversation = Pick<
  s.TConversation,
  'conversationId' | 'endpoint' | 'title' | 'createdAt' | 'updatedAt' | 'user'
>;

export type ConversationListResponse = {
  conversations: MinimalConversation[];
  nextCursor: string | null;
};

export type ConversationData = InfiniteData<ConversationListResponse>;
export type ConversationUpdater = (
  data: ConversationData,
  conversation: s.TConversation,
) => ConversationData;

/* Messages */
export type MessagesListParams = {
  cursor?: string | null;
  sortBy?: 'endpoint' | 'createdAt' | 'updatedAt';
  sortDirection?: 'asc' | 'desc';
  pageSize?: number;
  conversationId?: string;
  messageId?: string;
  search?: string;
};

export type MessagesListResponse = {
  messages: s.TMessage[];
  nextCursor: string | null;
};

/* Shared Links */
export type SharedMessagesResponse = Omit<s.TSharedLink, 'messages'> & {
  messages: s.TMessage[];
};

export interface SharedLinksListParams {
  pageSize: number;
  isPublic: boolean;
  sortBy: 'title' | 'createdAt';
  sortDirection: 'asc' | 'desc';
  search?: string;
  cursor?: string;
}

export type SharedLinkItem = {
  shareId: string;
  title: string;
  isPublic: boolean;
  createdAt: Date;
  conversationId: string;
};

export interface SharedLinksResponse {
  links: SharedLinkItem[];
  nextCursor: string | null;
  hasNextPage: boolean;
}

export interface SharedLinkQueryData {
  pages: SharedLinksResponse[];
  pageParams: (string | null)[];
}

export type AllPromptGroupsFilterRequest = {
  category: string;
  pageNumber: string;
  pageSize: string | number;
  before?: string | null;
  after?: string | null;
  order?: 'asc' | 'desc';
  name?: string;
  author?: string;
};

export type AllPromptGroupsResponse = t.TPromptGroup[];

export type ConversationTagsResponse = s.TConversationTag[];

/* MCP Types */
export type MCPTool = {
  name: string;
  pluginKey: string;
  description: string;
};

export type MCPServer = {
  name: string;
  icon: string;
  authenticated: boolean;
  authConfig: s.TPluginAuthConfig[];
  tools: MCPTool[];
};

export type MCPServersResponse = {
  servers: Record<string, MCPServer>;
};

export type VerifyToolAuthParams = { toolId: string };
export type VerifyToolAuthResponse = {
  authenticated: boolean;
  message?: string | s.AuthType;
  authTypes?: [string, s.AuthType][];
};

export type GetToolCallParams = { conversationId: string };
export type ToolCallResults = a.ToolCallResult[];

/* Memories */
export type TUserMemory = {
  key: string;
  value: string;
  updated_at: string;
  tokenCount?: number;
};

export type MemoriesResponse = {
  memories: TUserMemory[];
  totalTokens: number;
  tokenLimit: number | null;
  usagePercentage: number | null;
};

export type PrincipalSearchParams = {
  q: string;
  limit?: number;
  types?: Array<p.PrincipalType.USER | p.PrincipalType.GROUP | p.PrincipalType.ROLE>;
};

export type PrincipalSearchResponse = {
  query: string;
  limit: number;
  types?: Array<p.PrincipalType.USER | p.PrincipalType.GROUP | p.PrincipalType.ROLE>;
  results: p.TPrincipalSearchResult[];
  count: number;
  sources: {
    local: number;
    entra: number;
  };
};

export type AccessRole = {
  accessRoleId: p.AccessRoleIds;
  name: string;
  description: string;
  permBits: number;
};

export type AccessRolesResponse = AccessRole[];

export interface MCPServerStatus {
  requiresOAuth: boolean;
  connectionState: 'disconnected' | 'connecting' | 'connected' | 'error';
}

export interface MCPConnectionStatusResponse {
  success: boolean;
  connectionStatus: Record<string, MCPServerStatus>;
}

export interface MCPServerConnectionStatusResponse {
  success: boolean;
  serverName: string;
  requiresOAuth: boolean;
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error';
}

export interface MCPAuthValuesResponse {
  success: boolean;
  serverName: string;
  authValueFlags: Record<string, boolean>;
}

/* SharePoint Graph API Token */
export type GraphTokenParams = {
  scopes: string;
};

export type GraphTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
};

/* --- Admin Feedback --- */
export interface AdminFeedbackOverviewFilter {
  since?: string;
  until?: string;
  endpoint?: string;
  topic?: string;
  tag?: string;
}

export interface AdminFeedbackKpis {
  total: number;
  withFeedback: number;
  feedbackRate: number | null;
  thumbsUp: number;
  thumbsDown: number;
  positivePct: number | null;
}

export interface AdminFeedbackTopicRow {
  topic: string;
  total: number;
  withFeedback: number;
  positivePct: number | null;
  lastThumbsDownAt: string | null;
}

export interface AdminFeedbackToolRow {
  toolName: string;
  total: number;
  thumbsDown: number;
}

export interface AdminFeedbackTimePoint {
  date: string;
  total: number;
  withFeedback: number;
  up: number;
  down: number;
}

export interface AdminFeedbackOverview {
  range: { since: string | null; until: string | null };
  kpis: AdminFeedbackKpis;
  timeSeries: AdminFeedbackTimePoint[];
  byTopic: AdminFeedbackTopicRow[];
  byTool: AdminFeedbackToolRow[];
  pendingTopicsCount: number;
}

export interface AdminFeedbackDrillDownFilter {
  topic?: string;
  rating?: 'thumbsUp' | 'thumbsDown';
  pageSize?: number;
  cursor?: string;
}

export interface AdminFeedbackDrillDownMessage {
  messageId: string;
  conversationId: string;
  text?: string;
  createdAt?: string;
  feedback?: {
    rating: 'thumbsUp' | 'thumbsDown';
    tag?: import('../feedback').TFeedbackTag;
    text?: string;
    topic?: string;
  };
}

export interface AdminFeedbackDrillDownResponse {
  messages: AdminFeedbackDrillDownMessage[];
  nextCursor: string | null;
}

export interface AdminFeedbackPending {
  _id: string;
  proposedKey: string;
  labelHe: string;
  labelEn: string;
  rawLabels: string[];
  exampleMessageIds: string[];
  status: 'pending' | 'rejected';
  proposedAt: string;
}

export interface AdminFeedbackPendingResponse {
  pending: AdminFeedbackPending[];
}

/* --- Admin Prompts --- */
export type AdminPromptAgentType = 'unified';

export interface AdminPromptAgentSummary {
  agentType: AdminPromptAgentType;
  activeSections: number;
}

export interface AdminPromptAgentsResponse {
  agents: AdminPromptAgentSummary[];
}

export interface AdminPromptSection {
  _id: string;
  agentType: AdminPromptAgentType;
  sectionKey: string;
  ordinal: number;
  headerText: string;
  body: string;
  active: boolean;
  isDraft: boolean;
  parentVersionId?: string;
  changeNote?: string;
  createdAt: string;
  createdBy?: string;
  publishedAt?: string;
  hasDraft?: boolean;
}

export interface AdminPromptSectionsResponse {
  sections: AdminPromptSection[];
}

export interface AdminPromptVersion {
  _id: string;
  agentType: AdminPromptAgentType;
  sectionKey: string;
  ordinal: number;
  headerText: string;
  body: string;
  active: boolean;
  isDraft: boolean;
  parentVersionId?: string;
  changeNote?: string;
  createdAt: string;
  createdBy?: string;
  publishedAt?: string;
}

export interface AdminPromptVersionsResponse {
  versions: AdminPromptVersion[];
}

export interface AdminPromptSaveDraftInput {
  body: string;
  changeNote?: string;
}

export interface AdminPromptSaveDraftResponse {
  draft: AdminPromptSection;
}

export interface AdminPromptPublishInput {
  parentVersionId: string;
  body: string;
  changeNote: string;
}

export interface AdminPromptPublishResponse {
  active: AdminPromptSection;
}

export interface AdminPromptPublishConflictResponse {
  error: 'stale parent';
  current: AdminPromptSection | null;
}

export interface AdminPromptPreviewInput {
  body: string;
}

export interface AdminPromptPreviewAnswer {
  answer: string;
  toolCalls: unknown[];
}

export interface AdminPromptPreviewQuestionResult {
  text: string;
  current: AdminPromptPreviewAnswer;
  draft: AdminPromptPreviewAnswer;
  timedOut: boolean;
}

export interface AdminPromptPreviewResponse {
  shadowId: string;
  questions: AdminPromptPreviewQuestionResult[];
}

export interface AdminPromptRestoreInput {
  versionId: string;
}

export interface AdminPromptRestoreResponse {
  active: AdminPromptSection;
}

export interface AdminPromptTestQuestion {
  _id?: string;
  agentType: AdminPromptAgentType;
  text: string;
  ordinal: number;
  enabled: boolean;
  createdAt?: string;
  createdBy?: string;
}

export interface AdminPromptTestQuestionsResponse {
  questions: AdminPromptTestQuestion[];
}

export interface AdminPromptTestQuestionPutInput {
  questions: Array<{ text: string; enabled?: boolean }>;
}

export interface AdminPromptUsageConversation {
  conversationId: string;
  messageCount: number;
  lastMessageAt: string;
}

export interface AdminPromptUsage {
  windowStart: string;
  windowEnd: string | null;
  messageCount: number;
  conversationCount: number;
  conversations: AdminPromptUsageConversation[];
}

export interface AdminPromptJoinedVersion {
  sectionKey: string;
  ordinal: number;
  versionId: string;
}

export interface AdminPromptJoinedResponse {
  source: 'aurora';
  joinedText: string;
  versions: AdminPromptJoinedVersion[];
  hasDraft: boolean;
  draftAgentId: string | null;
}

export interface AdminPromptJoinedDraftInput {
  joinedText: string;
  changeNote?: string;
}

export interface AdminPromptJoinedDraftResponse {
  drafts: AdminPromptSection[];
  summary: { sectionsTouched: number; sectionsTotal: number };
  draftAgentId: string | null;
  hasDraft: boolean;
}

export interface AdminPromptJoinedPublishInput {
  changeNote: string;
}

export interface AdminPromptJoinedPublishResponse {
  active: AdminPromptSection[];
  summary: { sectionsPublished: number };
}

export interface AdminPromptSnapshot {
  agentType: AdminPromptAgentType;
  snapshotMinute: string;
  sectionVersionIds: string[];
  sectionKeys: string[];
  publishedBy: string | null;
}

export interface AdminPromptSnapshotsResponse {
  snapshots: AdminPromptSnapshot[];
}

export interface AdminPromptSnapshotRestoreResponse {
  active: AdminPromptSection[];
  summary: { sectionsRestored: number };
}

/* --- Admin Sources --- */
export interface SparklinePoint {
  at: string;
  count: number;
}

export interface AdminSourcesContext {
  context: string;
  doc_count: number;
  prev_count: number | null;
  sparkline: SparklinePoint[];
  last_synced_at: string;
  source_count: number;
  drift_alert: boolean;
}

export interface AdminSourcesResponse {
  contexts: AdminSourcesContext[];
}

export interface AdminSourceItem {
  source_id: string;
  doc_count: number;
  sparkline: SparklinePoint[];
  delta_7d: number;
}

export interface AdminSourceContextSummary {
  context: string;
  doc_count: number;
  last_synced_at: string;
  sparkline: SparklinePoint[];
}

export interface AdminSourceResponse {
  context_summary: AdminSourceContextSummary | null;
  sources: AdminSourceItem[];
}
