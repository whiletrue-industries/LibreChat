import { useEffect, useState } from 'react';
import type {
  AdminPromptToolOverrideEntry,
  AdminPromptToolOverrideRow as ToolOverrideVersion,
} from 'librechat-data-provider';
import {
  useClearToolOverride,
  usePublishToolOverride,
  useRestoreToolOverride,
  useSaveToolOverrideDraft,
} from '~/data-provider/AdminPrompts/queries';
import { useLocalize } from '~/hooks';
import ToolOverrideVersionsModal from './ToolOverrideVersionsModal';

interface ToolOverrideRowProps {
  agentType: string;
  entry: AdminPromptToolOverrideEntry;
  expanded: boolean;
  onToggle: () => void;
}

export default function ToolOverrideRow({
  agentType,
  entry,
  expanded,
  onToggle,
}: ToolOverrideRowProps) {
  const localize = useLocalize();
  const saveDraft = useSaveToolOverrideDraft(agentType);
  const publish = usePublishToolOverride(agentType);
  const clearOverride = useClearToolOverride(agentType);
  const restore = useRestoreToolOverride(agentType);

  const baseDescription =
    entry.override?.description ?? entry.defaultDescription;
  const [text, setText] = useState(baseDescription);
  const [changeNote, setChangeNote] = useState('');
  const [draftId, setDraftId] = useState<number | null>(null);
  const [parentVersionId, setParentVersionId] = useState<number | null>(
    entry.override?.id ?? null,
  );
  const [versionsOpen, setVersionsOpen] = useState(false);

  useEffect(() => {
    setText(baseDescription);
    setParentVersionId(entry.override?.id ?? null);
    setDraftId(null);
  }, [baseDescription, entry.override?.id]);

  const isOverridden = entry.override !== null;
  const isDirty = text !== baseDescription;

  const handleSaveDraft = () => {
    saveDraft.mutate(
      {
        toolName: entry.toolName,
        input: { description: text, changeNote: changeNote || undefined },
      },
      {
        onSuccess: (data) => {
          setDraftId(data.draft.id);
          setParentVersionId(data.draft.parentVersionId);
        },
      },
    );
  };

  const handlePublish = () => {
    if (draftId === null || !changeNote) return;
    publish.mutate(
      {
        toolName: entry.toolName,
        input: { draftId, parentVersionId, changeNote },
      },
      {
        onSuccess: () => {
          setDraftId(null);
          setChangeNote('');
        },
      },
    );
  };

  const handleClear = () => {
    clearOverride.mutate(
      { toolName: entry.toolName },
      {
        onSuccess: () => {
          setDraftId(null);
          setChangeNote('');
        },
      },
    );
  };

  const handleRestore = (version: ToolOverrideVersion) => {
    restore.mutate(
      {
        toolName: entry.toolName,
        input: { versionId: version.id },
      },
      {
        onSuccess: () => {
          setVersionsOpen(false);
          setDraftId(null);
          setChangeNote('');
        },
      },
    );
  };

  return (
    <>
      <tr
        data-testid={`tool-override-row-${entry.toolName}`}
        className="cursor-pointer border-b border-border-light hover:bg-surface-primary-alt"
        onClick={onToggle}
      >
        <td className="p-3 align-top font-mono text-sm">{entry.toolName}</td>
        <td className="p-3 align-top text-sm">
          {isOverridden ? (
            <span className="rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] text-white">
              {localize('com_admin_tool_active_override')}
            </span>
          ) : (
            <span className="rounded bg-surface-primary-alt px-1.5 py-0.5 text-[10px] text-text-secondary">
              {localize('com_admin_tool_default_description')}
            </span>
          )}
        </td>
        <td className="p-3 align-top text-xs text-text-secondary">
          {entry.override?.publishedAt
            ? new Date(entry.override.publishedAt).toLocaleString()
            : '—'}
        </td>
        <td className="p-3 align-top text-right text-xs">
          {expanded ? '▼' : '▶'}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={4} className="bg-surface-primary-alt p-3">
            <div className="flex flex-col gap-3">
              <div className="text-xs text-text-secondary">
                <span className="font-semibold">
                  {localize('com_admin_tool_default_description')}:
                </span>{' '}
                <span className="font-mono">{entry.defaultDescription}</span>
              </div>
              <textarea
                data-testid={`tool-override-textarea-${entry.toolName}`}
                aria-label={localize('com_admin_tool_override_textarea')}
                value={text}
                onChange={(e) => setText(e.target.value)}
                className="min-h-[8rem] w-full rounded border border-border-medium bg-surface-primary p-2 font-mono text-sm leading-6 text-text-primary"
                spellCheck={false}
              />
              <input
                type="text"
                value={changeNote}
                onChange={(e) => setChangeNote(e.target.value)}
                placeholder={localize('com_admin_prompts_change_note')}
                className="rounded border border-border-medium bg-surface-primary p-2 text-sm text-text-primary"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveDraft}
                  disabled={!isDirty || saveDraft.isLoading}
                  className="rounded bg-surface-primary px-3 py-1 text-sm disabled:opacity-50"
                >
                  {localize('com_admin_tool_save_override_draft')}
                </button>
                <button
                  type="button"
                  onClick={handlePublish}
                  disabled={
                    draftId === null || !changeNote || publish.isLoading
                  }
                  className="rounded bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-50"
                >
                  {localize('com_admin_tool_publish_override')}
                </button>
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={!isOverridden || clearOverride.isLoading}
                  className="rounded bg-surface-primary px-3 py-1 text-sm disabled:opacity-50"
                >
                  {localize('com_admin_tool_clear_override')}
                </button>
                <button
                  type="button"
                  onClick={() => setVersionsOpen(true)}
                  className="rounded bg-surface-primary px-3 py-1 text-sm"
                >
                  {localize('com_admin_tool_versions')}…
                </button>
              </div>
              {saveDraft.isError && (
                <div className="text-xs text-red-600">
                  {(saveDraft.error as Error | undefined)?.message ??
                    localize('com_admin_prompts_save_failed')}
                </div>
              )}
              {publish.isError && (
                <div className="text-xs text-red-600">
                  {localize('com_admin_prompts_publish_failed')}
                </div>
              )}
              {clearOverride.isError && (
                <div className="text-xs text-red-600">
                  {(clearOverride.error as Error | undefined)?.message ??
                    localize('com_admin_prompts_save_failed')}
                </div>
              )}
              {restore.isError && (
                <div className="text-xs text-red-600">
                  {(restore.error as Error | undefined)?.message ??
                    localize('com_admin_prompts_save_failed')}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
      {versionsOpen && (
        <tr>
          <td colSpan={4} className="p-0">
            <ToolOverrideVersionsModal
              agentType={agentType}
              toolName={entry.toolName}
              isRestoring={restore.isLoading}
              onClose={() => setVersionsOpen(false)}
              onRestore={handleRestore}
            />
          </td>
        </tr>
      )}
    </>
  );
}
