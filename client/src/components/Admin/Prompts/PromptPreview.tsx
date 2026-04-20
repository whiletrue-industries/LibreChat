import { usePreviewAdminPrompt } from '~/data-provider/AdminPrompts/queries';
import { useLocalize } from '~/hooks';

export interface PromptPreviewProps {
  agentType: string;
  sectionKey: string;
  draftBody: string;
}

export default function PromptPreview({ agentType, sectionKey, draftBody }: PromptPreviewProps) {
  const localize = useLocalize();
  const preview = usePreviewAdminPrompt();

  const run = () => {
    preview.mutate({
      agentType,
      sectionKey,
      input: { body: draftBody },
    });
  };

  return (
    <div className="mt-4 rounded border border-border-medium bg-surface-primary-alt p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">{localize('com_admin_prompts_preview_header')}</h3>
        <button
          type="button"
          onClick={run}
          disabled={preview.isLoading}
          className="rounded bg-surface-primary px-3 py-1 text-sm disabled:opacity-50"
        >
          {localize('com_admin_prompts_preview')}
        </button>
      </div>
      {preview.isError && (
        <div className="text-xs text-red-600">Preview failed.</div>
      )}
      {preview.data && (
        <div className="space-y-3">
          {preview.data.questions.map((q, i) => (
            <div
              key={i}
              className="rounded border border-border-light bg-surface-primary p-2 text-sm"
            >
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono text-xs text-text-secondary">Q{i + 1}: {q.text}</span>
                {q.timedOut && (
                  <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-900 dark:bg-red-900 dark:text-red-100">
                    {localize('com_admin_prompts_preview_timed_out')}
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs font-medium text-text-secondary">
                    {localize('com_admin_prompts_preview_current')}
                  </div>
                  <div className="whitespace-pre-wrap">{q.current.answer}</div>
                </div>
                <div>
                  <div className="text-xs font-medium text-text-secondary">
                    {localize('com_admin_prompts_preview_draft')}
                  </div>
                  <div className="whitespace-pre-wrap">{q.draft.answer}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
