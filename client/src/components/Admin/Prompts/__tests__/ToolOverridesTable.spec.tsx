import React from 'react';
import { fireEvent, render, screen } from 'test/layout-test-utils';
import { ToolOverridesTable } from '../';

jest.mock('~/hooks', () => ({
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

const fixtureTools = {
  tools: [
    {
      toolName: 'search_unified__legal_text',
      defaultDescription: 'Default legal text search',
      override: {
        id: 7,
        description: 'Overridden legal text search',
        publishedAt: '2026-04-01T12:00:00.000Z',
      },
    },
    {
      toolName: 'search_unified__common_knowledge',
      defaultDescription: 'Default common knowledge search',
      override: null,
    },
    {
      toolName: 'budget_lookup',
      defaultDescription: 'Look up budget items',
      override: null,
    },
  ],
};

const fixtureVersions = {
  versions: [
    {
      id: 7,
      agentType: 'unified' as const,
      toolName: 'search_unified__legal_text',
      description: 'Overridden legal text search',
      active: true,
      isDraft: false,
      parentVersionId: null,
      changeNote: 'first publish',
      createdAt: '2026-04-01T12:00:00.000Z',
      createdBy: 'admin@example.com',
      publishedAt: '2026-04-01T12:00:00.000Z',
    },
    {
      id: 6,
      agentType: 'unified' as const,
      toolName: 'search_unified__legal_text',
      description: 'Older description',
      active: false,
      isDraft: false,
      parentVersionId: null,
      changeNote: 'older note',
      createdAt: '2026-03-01T12:00:00.000Z',
      createdBy: 'admin@example.com',
      publishedAt: '2026-03-01T12:00:00.000Z',
    },
  ],
};

const mockSaveDraftMutate = jest.fn();
const mockPublishMutate = jest.fn();
const mockClearMutate = jest.fn();
const mockRestoreMutate = jest.fn();

jest.mock('~/data-provider/AdminPrompts/queries', () => ({
  useToolOverrides: () => ({
    isLoading: false,
    isError: false,
    data: fixtureTools,
  }),
  useToolOverrideVersions: () => ({
    isLoading: false,
    isError: false,
    data: fixtureVersions,
  }),
  useSaveToolOverrideDraft: () => ({
    mutate: mockSaveDraftMutate,
    isLoading: false,
    isError: false,
  }),
  usePublishToolOverride: () => ({
    mutate: mockPublishMutate,
    isLoading: false,
    isError: false,
  }),
  useClearToolOverride: () => ({
    mutate: mockClearMutate,
    isLoading: false,
    isError: false,
  }),
  useRestoreToolOverride: () => ({
    mutate: mockRestoreMutate,
    isLoading: false,
    isError: false,
  }),
}));

describe('ToolOverridesTable', () => {
  beforeEach(() => {
    mockSaveDraftMutate.mockReset();
    mockPublishMutate.mockReset();
    mockClearMutate.mockReset();
    mockRestoreMutate.mockReset();
  });

  it('renders the canonical tool list with override status', () => {
    const { asFragment } = render(<ToolOverridesTable agentType="unified" />);
    expect(
      screen.getByTestId('tool-override-row-search_unified__legal_text'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('tool-override-row-search_unified__common_knowledge'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('tool-override-row-budget_lookup'),
    ).toBeInTheDocument();
    expect(asFragment()).toMatchSnapshot();
  });

  it('expanding a row shows a textarea pre-filled with the active override', () => {
    render(<ToolOverridesTable agentType="unified" />);
    fireEvent.click(
      screen.getByTestId('tool-override-row-search_unified__legal_text'),
    );
    const textarea = screen.getByTestId(
      'tool-override-textarea-search_unified__legal_text',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Overridden legal text search');
  });

  it('expanding an un-overridden row pre-fills the canonical default', () => {
    render(<ToolOverridesTable agentType="unified" />);
    fireEvent.click(screen.getByTestId('tool-override-row-budget_lookup'));
    const textarea = screen.getByTestId(
      'tool-override-textarea-budget_lookup',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Look up budget items');
  });

  it('Save override draft is disabled until the textarea changes, then calls the mutation', () => {
    render(<ToolOverridesTable agentType="unified" />);
    fireEvent.click(screen.getByTestId('tool-override-row-budget_lookup'));
    const save = screen.getByRole('button', {
      name: 'com_admin_tool_save_override_draft',
    });
    expect(save).toBeDisabled();

    const textarea = screen.getByTestId(
      'tool-override-textarea-budget_lookup',
    ) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'New override body' } });
    expect(save).toBeEnabled();

    fireEvent.click(save);
    expect(mockSaveDraftMutate).toHaveBeenCalledTimes(1);
    const [variables] = mockSaveDraftMutate.mock.calls[0];
    expect(variables).toEqual({
      toolName: 'budget_lookup',
      input: { description: 'New override body', changeNote: undefined },
    });
  });

  it('Clear override calls the clear mutation with the tool name', () => {
    render(<ToolOverridesTable agentType="unified" />);
    fireEvent.click(
      screen.getByTestId('tool-override-row-search_unified__legal_text'),
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'com_admin_tool_clear_override' }),
    );
    expect(mockClearMutate).toHaveBeenCalledTimes(1);
    const [variables] = mockClearMutate.mock.calls[0];
    expect(variables).toEqual({ toolName: 'search_unified__legal_text' });
  });

  it('Restore from history calls the restore mutation with the version id', () => {
    render(<ToolOverridesTable agentType="unified" />);
    fireEvent.click(
      screen.getByTestId('tool-override-row-search_unified__legal_text'),
    );
    fireEvent.click(screen.getByRole('button', { name: 'com_admin_tool_versions…' }));
    const restoreButtons = screen.getAllByRole('button', {
      name: 'com_admin_prompts_restore',
    });
    const inactiveRestore = restoreButtons.find(
      (btn) => !(btn as HTMLButtonElement).disabled,
    );
    expect(inactiveRestore).toBeDefined();
    fireEvent.click(inactiveRestore!);
    expect(mockRestoreMutate).toHaveBeenCalledTimes(1);
    const [variables] = mockRestoreMutate.mock.calls[0];
    expect(variables).toEqual({
      toolName: 'search_unified__legal_text',
      input: { versionId: 6 },
    });
  });
});
