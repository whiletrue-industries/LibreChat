import { useEffect, useState } from 'react';
import type { AdminPromptTestQuestion } from 'librechat-data-provider';
import {
  useAdminPromptTestQuestions,
  usePutAdminPromptTestQuestions,
} from '~/data-provider/AdminPrompts/queries';
import { useLocalize } from '~/hooks';

export interface TestQuestionsProps {
  agentType: string;
}

interface Row {
  text: string;
  enabled: boolean;
}

export default function TestQuestions({ agentType }: TestQuestionsProps) {
  const localize = useLocalize();
  const q = useAdminPromptTestQuestions(agentType);
  const put = usePutAdminPromptTestQuestions();
  const [rows, setRows] = useState<Row[]>([]);

  useEffect(() => {
    if (q.data) {
      setRows(
        q.data.questions.map((r: AdminPromptTestQuestion) => ({
          text: r.text,
          enabled: r.enabled,
        })),
      );
    }
  }, [q.data]);

  const save = () => put.mutate({ agentType, input: { questions: rows } });
  const addRow = () => setRows((prev) => [...prev, { text: '', enabled: true }]);
  const updateRow = (i: number, patch: Partial<Row>) =>
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRow = (i: number) =>
    setRows((prev) => prev.filter((_, idx) => idx !== i));

  return (
    <div className="mt-4 rounded border border-border-medium bg-surface-primary-alt p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium">{localize('com_admin_prompts_test_questions')}</h3>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={addRow}
            className="rounded bg-surface-primary px-2 py-0.5 text-xs"
          >
            + {localize('com_admin_prompts_add_test_question')}
          </button>
          <button
            type="button"
            onClick={save}
            disabled={put.isLoading}
            className="rounded bg-emerald-600 px-2 py-0.5 text-xs text-white disabled:opacity-50"
          >
            {localize('com_ui_save')}
          </button>
        </div>
      </div>
      <ul className="space-y-1">
        {rows.map((r, i) => (
          <li key={i} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={r.enabled}
              onChange={(e) => updateRow(i, { enabled: e.target.checked })}
            />
            <input
              type="text"
              value={r.text}
              onChange={(e) => updateRow(i, { text: e.target.value })}
              dir="rtl"
              className="flex-1 rounded border border-border-light bg-surface-primary p-1 text-sm"
            />
            <button
              type="button"
              onClick={() => removeRow(i)}
              className="text-xs text-red-600"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
