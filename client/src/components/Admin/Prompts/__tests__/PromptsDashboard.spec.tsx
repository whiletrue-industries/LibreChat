import React from 'react';
import { render, screen } from 'test/layout-test-utils';
import { PromptsDashboard } from '../';

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: { role: 'ADMIN' } }),
  useLocalize: () => (key: string) => key,
}));

const mockAgents = jest.fn();
jest.mock('~/data-provider/AdminPrompts/queries', () => ({
  useAdminPromptAgents: () => mockAgents(),
  useAdminPromptSections: () => ({ isLoading: false, data: { sections: [] } }),
  useAdminPromptVersions: () => ({ isLoading: false, data: { versions: [] } }),
  useSaveAdminPromptDraft: () => ({ mutate: jest.fn() }),
  usePublishAdminPrompt: () => ({ mutate: jest.fn() }),
  usePreviewAdminPrompt: () => ({ mutate: jest.fn() }),
  useRestoreAdminPrompt: () => ({ mutate: jest.fn() }),
  useAdminPromptTestQuestions: () => ({ data: { questions: [] } }),
  usePutAdminPromptTestQuestions: () => ({ mutate: jest.fn() }),
  useAdminPromptVersionUsage: () => ({ isLoading: false, data: undefined }),
}));

describe('PromptsDashboard', () => {
  it('renders the unified agent card', () => {
    mockAgents.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        agents: [{ agentType: 'unified', activeSections: 10 }],
      },
    });
    render(<PromptsDashboard />);
    expect(screen.getByText('com_admin_prompts_agent_unified')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('renders the title', () => {
    mockAgents.mockReturnValue({
      isLoading: false,
      data: { agents: [] },
    });
    render(<PromptsDashboard />);
    expect(screen.getByText('com_admin_prompts_title')).toBeInTheDocument();
  });

  it('renders loading placeholder', () => {
    mockAgents.mockReturnValue({ isLoading: true });
    const { container } = render(<PromptsDashboard />);
    expect(container.textContent).toContain('…');
  });
});
