import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { SystemRoles } from 'librechat-data-provider';
import {
  useJoinedPrompt,
  useSaveJoinedDraft,
  usePublishJoinedDraft,
} from '~/data-provider/AdminPrompts/queries';
import { useAuthContext, useLocalize } from '~/hooks';
import SnapshotsSidebar from './SnapshotsSidebar';

type LocalizeKey = Parameters<ReturnType<typeof useLocalize>>[0];
const VALID: ReadonlyArray<'unified'> = ['unified'];

export default function UnifiedPromptEditor() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { agent } = useParams<{ agent: string }>();
  const joinedQ = useJoinedPrompt(agent ?? '');
  const saveDraft = useSaveJoinedDraft(agent ?? '');
  const publish = usePublishJoinedDraft(agent ?? '');

  const [text, setText] = useState('');
  const [changeNote, setChangeNote] = useState('');
  const [snapshotsOpen, setSnapshotsOpen] = useState(false);
  const [draftAgentId, setDraftAgentId] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState(false);
  const [saveSummary, setSaveSummary] = useState<{
    touched: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    if (joinedQ.data) {
      setText((current) => (current === '' ? joinedQ.data!.joinedText : current));
      setDraftAgentId(joinedQ.data.draftAgentId);
      setHasDraft(joinedQ.data.hasDraft);
    }
  }, [joinedQ.data]);

  if (user?.role !== SystemRoles.ADMIN) {
    navigate('/c/new', { replace: true });
    return null;
  }
  if (!agent || !VALID.includes(agent as (typeof VALID)[number])) {
    navigate('/d/agent-prompts', { replace: true });
    return null;
  }
  if (joinedQ.isLoading || !joinedQ.data) {
    return <div className="p-8 text-center">…</div>;
  }
  if (joinedQ.isError) {
    const message = (joinedQ.error as Error | undefined)?.message ?? 'Error';
    return <div className="p-8 text-center text-red-600">{message}</div>;
  }

  const isDirty = text !== joinedQ.data.joinedText;

  const handleSaveDraft = () => {
    setSaveSummary(null);
    saveDraft.mutate(
      { joinedText: text, changeNote: changeNote || undefined },
      {
        onSuccess: (data) => {
          setDraftAgentId(data.draftAgentId);
          setHasDraft(data.hasDraft);
          setSaveSummary({
            touched: data.summary.sectionsTouched,
            total: data.summary.sectionsTotal,
          });
        },
      },
    );
  };

  const handlePublish = () => {
    publish.mutate(
      { changeNote },
      {
        onSuccess: () => {
          setHasDraft(false);
          setChangeNote('');
          setSaveSummary(null);
        },
      },
    );
  };

  const handleTryDraft = () => {
    if (!draftAgentId) return;
    window.open(`/c/new?agent_id=${encodeURIComponent(draftAgentId)}`, '_blank');
  };

  return (
    <main
      className="mx-auto w-full max-w-7xl bg-surface-primary p-6 text-text-primary"
      dir="ltr"
    >
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            {localize('com_admin_prompts_unified_editor_title')}
            <span className="mx-2 text-text-secondary">—</span>
            <span>{localize(`com_admin_prompts_agent_${agent}` as LocalizeKey)}</span>
          </h1>
          <p className="mt-1 text-xs text-text-secondary">
            {localize('com_admin_prompts_unified_editor_subtitle')}
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <Link to={`/d/agent-prompts/${agent}/sections`} className="underline">
            {localize('com_admin_prompts_per_section_view')}
          </Link>
          <Link to="/d/agent-prompts" className="underline">
            ← {localize('com_admin_prompts_title')}
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-3">
          <textarea
            data-testid="unified-prompt-textarea"
            aria-label={localize('com_admin_prompts_unified_editor_title')}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[60vh] w-full rounded border border-border-medium bg-surface-primary-alt p-3 font-mono text-sm leading-6 text-text-primary"
            spellCheck={false}
          />

          <input
            type="text"
            value={changeNote}
            onChange={(e) => setChangeNote(e.target.value)}
            placeholder={localize('com_admin_prompts_change_note')}
            className="rounded border border-border-medium bg-surface-primary-alt p-2 text-sm text-text-primary"
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={!isDirty || saveDraft.isLoading}
              className="rounded bg-surface-primary-alt px-3 py-1 text-sm disabled:opacity-50"
            >
              {localize('com_admin_prompts_save_draft')}
            </button>
            <button
              type="button"
              onClick={handlePublish}
              disabled={!hasDraft || !changeNote || publish.isLoading}
              className="rounded bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-50"
            >
              {localize('com_admin_prompts_publish')}
            </button>
            <button
              type="button"
              onClick={handleTryDraft}
              disabled={!hasDraft || !draftAgentId}
              className="rounded bg-surface-primary-alt px-3 py-1 text-sm disabled:opacity-50"
            >
              {localize('com_admin_prompts_try_draft')}
            </button>
            <button
              type="button"
              onClick={() => setSnapshotsOpen((v) => !v)}
              className="rounded bg-surface-primary-alt px-3 py-1 text-sm"
            >
              {localize('com_admin_prompts_snapshots')}…
            </button>
          </div>

          {saveSummary && (
            <div className="text-xs text-text-secondary">
              {localize('com_admin_prompts_save_draft_summary', {
                touched: saveSummary.touched,
                total: saveSummary.total,
              })}
            </div>
          )}
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
        </div>

        {snapshotsOpen && agent && <SnapshotsSidebar agentType={agent} />}
      </div>
    </main>
  );
}
