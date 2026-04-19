import { useNavigate } from 'react-router-dom';
import { SystemRoles } from 'librechat-data-provider';
import { useAdminPromptAgents } from '~/data-provider/AdminPrompts/queries';
import { useAuthContext, useLocalize } from '~/hooks';

type LocalizeKey = Parameters<ReturnType<typeof useLocalize>>[0];

export default function PromptsDashboard() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const agents = useAdminPromptAgents();

  if (user?.role !== SystemRoles.ADMIN) {
    navigate('/c/new', { replace: true });
    return null;
  }

  if (agents.isLoading) {
    return <div className="p-8 text-center">…</div>;
  }

  if (agents.isError || !agents.data) {
    const message = (agents.error as Error | undefined)?.message ?? 'Error';
    return <div className="p-8 text-center text-red-600">{message}</div>;
  }

  return (
    <main className="mx-auto max-w-6xl bg-surface-primary p-6 text-text-primary">
      <h1 className="mb-4 text-xl font-semibold">
        {localize('com_admin_prompts_title')}
      </h1>
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {agents.data.agents.map((a) => (
          <li
            key={a.agentType}
            className="rounded-lg border border-border-medium bg-surface-primary-alt p-4"
          >
            <button
              type="button"
              onClick={() => navigate(`/d/agent-prompts/${a.agentType}`)}
              className="w-full text-start"
            >
              <div className="text-sm font-medium">
                {localize(`com_admin_prompts_agent_${a.agentType}` as LocalizeKey)}
              </div>
              <div className="mt-1 text-2xl font-semibold">{a.activeSections}</div>
              <div className="text-xs text-text-secondary">
                {localize('com_admin_prompts_sections')}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
