import { useState } from 'react';
import { useToolOverrides } from '~/data-provider/AdminPrompts/queries';
import { useLocalize } from '~/hooks';
import ToolOverrideRow from './ToolOverrideRow';

interface ToolOverridesTableProps {
  agentType: string;
}

export default function ToolOverridesTable({ agentType }: ToolOverridesTableProps) {
  const localize = useLocalize();
  const toolsQ = useToolOverrides(agentType);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (toolName: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(toolName)) {
        next.delete(toolName);
      } else {
        next.add(toolName);
      }
      return next;
    });
  };

  const renderBody = () => {
    if (toolsQ.isLoading) {
      return (
        <tr>
          <td colSpan={4} className="p-3 text-sm text-text-secondary">
            …
          </td>
        </tr>
      );
    }
    if (toolsQ.isError || !toolsQ.data) {
      const message = (toolsQ.error as Error | undefined)?.message ?? localize('com_ui_error');
      return (
        <tr>
          <td colSpan={4} className="p-3 text-sm text-red-600">
            {message}
          </td>
        </tr>
      );
    }
    const tools = toolsQ.data.tools;
    if (tools.length === 0) {
      return (
        <tr>
          <td colSpan={4} className="p-3 text-sm text-text-secondary">
            {localize('com_admin_tool_overrides_empty')}
          </td>
        </tr>
      );
    }
    return tools.map((entry) => (
      <ToolOverrideRow
        key={entry.toolName}
        agentType={agentType}
        entry={entry}
        expanded={expanded.has(entry.toolName)}
        onToggle={() => toggle(entry.toolName)}
      />
    ));
  };

  return (
    <section
      data-testid="tool-overrides-table"
      className="mt-6 rounded border border-border-medium bg-surface-primary-alt"
    >
      <div className="border-b border-border-light p-3 text-sm font-semibold">
        {localize('com_admin_tool_overrides_title')}
      </div>
      <div className="overflow-auto">
        <table className="w-full table-fixed">
          <thead className="bg-surface-primary text-left text-xs uppercase text-text-secondary">
            <tr>
              <th className="w-1/3 p-3">{localize('com_admin_tool_name')}</th>
              <th className="w-1/6 p-3">{localize('com_admin_tool_status')}</th>
              <th className="w-1/3 p-3">{localize('com_admin_tool_published_at')}</th>
              <th className="w-12 p-3" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>{renderBody()}</tbody>
        </table>
      </div>
    </section>
  );
}
