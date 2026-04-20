import { useEffect, useMemo, useState } from 'react';
import Editor from '@monaco-editor/react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { SystemRoles } from 'librechat-data-provider';
import type { AdminPromptSection } from 'librechat-data-provider';
import {
  useAdminPromptSections,
  useSaveAdminPromptDraft,
  usePublishAdminPrompt,
} from '~/data-provider/AdminPrompts/queries';
import { useAuthContext, useLocalize } from '~/hooks';
import PromptDiff from './PromptDiff';
import PromptHistory from './PromptHistory';
import PromptPreview from './PromptPreview';
import TestQuestions from './TestQuestions';

type LocalizeKey = Parameters<ReturnType<typeof useLocalize>>[0];

export default function PromptEditor() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { agent, key } = useParams<{ agent: string; key: string }>();
  const sectionsQ = useAdminPromptSections(agent ?? '');
  const saveDraft = useSaveAdminPromptDraft();
  const publish = usePublishAdminPrompt();
  const [conflict, setConflict] = useState<AdminPromptSection | null>(null);

  const active: AdminPromptSection | null = useMemo(() => {
    return sectionsQ.data?.sections.find((s) => s.sectionKey === key) ?? null;
  }, [sectionsQ.data, key]);

  const [body, setBody] = useState('');
  const [changeNote, setChangeNote] = useState('');

  useEffect(() => {
    if (active && body === '') {
      setBody(active.body);
    }
  }, [active, body]);

  if (user?.role !== SystemRoles.ADMIN) {
    navigate('/c/new', { replace: true });
    return null;
  }
  if (!agent || !key) {
    navigate('/d/agent-prompts', { replace: true });
    return null;
  }
  if (sectionsQ.isLoading || !sectionsQ.data) {
    return <div className="p-8 text-center">…</div>;
  }
  if (!active) {
    return <div className="p-8 text-center text-red-600">Section not found</div>;
  }

  const isDirty = body !== active.body;

  const handleSaveDraft = () =>
    saveDraft.mutate({
      agentType: agent,
      sectionKey: key,
      input: { body, changeNote: changeNote || undefined },
    });

  const handlePublish = () => {
    setConflict(null);
    publish.mutate(
      {
        agentType: agent,
        sectionKey: key,
        input: { parentVersionId: active._id, body, changeNote },
      },
      {
        onError: (err: unknown) => {
          const e = err as {
            response?: { status?: number; data?: { current?: AdminPromptSection } };
          };
          if (e?.response?.status === 409 && e.response.data?.current) {
            setConflict(e.response.data.current);
          }
        },
      },
    );
  };

  return (
    <main className="mx-auto max-w-6xl bg-surface-primary p-6 text-text-primary">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          <span className="font-mono text-base">{key}</span>
          <span className="mx-2 text-text-secondary">—</span>
          <span>{localize(`com_admin_prompts_agent_${agent}` as LocalizeKey)}</span>
        </h1>
        <Link to={`/d/agent-prompts/${agent}`} className="text-sm underline">
          ← {localize('com_admin_prompts_sections')}
        </Link>
      </div>

      {conflict && (
        <div className="mb-4 rounded border border-red-400 bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900 dark:text-red-100">
          {localize('com_admin_prompts_stale_parent')}
          <div className="mt-2">
            <PromptDiff current={conflict.body} draft={body} readOnly />
          </div>
        </div>
      )}

      <div className="rounded border border-border-medium">
        <Editor
          height="45vh"
          language="markdown"
          theme="vs"
          value={body}
          onChange={(v) => setBody(v ?? '')}
          options={{
            wordWrap: 'on',
            fontSize: 16,
            lineHeight: 24,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            padding: { top: 12, bottom: 12 },
            renderWhitespace: 'boundary',
          }}
        />
      </div>

      <div className="mt-4 flex flex-col gap-3">
        <input
          type="text"
          value={changeNote}
          onChange={(e) => setChangeNote(e.target.value)}
          placeholder={localize('com_admin_prompts_change_note')}
          className="rounded border border-border-medium bg-surface-primary-alt p-2 text-sm text-text-primary"
        />
        <div className="flex gap-2">
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
            disabled={!isDirty || !changeNote || publish.isLoading}
            className="rounded bg-emerald-600 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            {localize('com_admin_prompts_publish')}
          </button>
        </div>
        {publish.isError && !conflict && (
          <div className="text-xs text-red-600">Publish failed.</div>
        )}
      </div>

      <PromptPreview agentType={agent} sectionKey={key} draftBody={body} />
      <TestQuestions agentType={agent} />
      <PromptHistory agentType={agent} sectionKey={key} />
    </main>
  );
}
