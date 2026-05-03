import { Link, useNavigate, useParams } from 'react-router-dom';
import { SystemRoles } from 'librechat-data-provider';
import { useAdminPromptSections } from '~/data-provider/AdminPrompts/queries';
import { useAuthContext, useLocalize } from '~/hooks';

type LocalizeKey = Parameters<ReturnType<typeof useLocalize>>[0];
const VALID: ReadonlyArray<'unified'> = ['unified'];

export default function PromptSectionList() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { agent } = useParams<{ agent: string }>();
  const sections = useAdminPromptSections(agent ?? '');

  if (user?.role !== SystemRoles.ADMIN) {
    navigate('/c/new', { replace: true });
    return null;
  }
  if (!agent || !VALID.includes(agent as (typeof VALID)[number])) {
    navigate('/d/agent-prompts', { replace: true });
    return null;
  }

  if (sections.isLoading) {
    return <div className="p-8 text-center">…</div>;
  }
  if (sections.isError || !sections.data) {
    return <div className="p-8 text-center text-red-600">Error</div>;
  }

  const rows = sections.data.sections;

  return (
    <main className="mx-auto w-full max-w-7xl bg-surface-primary p-6 text-text-primary" dir="ltr">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          {localize(`com_admin_prompts_agent_${agent}` as LocalizeKey)}
        </h1>
        <Link to="/d/agent-prompts" className="text-sm underline">
          ← {localize('com_admin_prompts_title')}
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-border-medium bg-surface-primary-alt p-6 text-center text-text-secondary">
          {localize('com_admin_prompts_empty')}
        </div>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border-medium text-start text-text-secondary">
              <th className="py-2 text-start">{localize('com_admin_prompts_section_key')}</th>
              <th className="py-2 text-start">{localize('com_admin_prompts_ordinal')}</th>
              <th className="py-2 text-start">{localize('com_admin_prompts_last_edited')}</th>
              <th className="py-2 text-start"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.sectionKey}
                onClick={() => navigate(`/d/agent-prompts/${agent}/${row.sectionKey}`)}
                className="cursor-pointer border-b border-border-light hover:bg-surface-primary-alt"
              >
                <td className="py-2 font-mono text-xs">{row.sectionKey}</td>
                <td className="py-2">{row.ordinal}</td>
                <td className="py-2">{new Date(row.createdAt).toLocaleString()}</td>
                <td className="py-2">
                  {row.hasDraft && (
                    <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                      {localize('com_admin_prompts_has_draft')}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
