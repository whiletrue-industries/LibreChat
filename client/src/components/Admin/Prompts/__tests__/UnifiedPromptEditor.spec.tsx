import React from 'react';
import { act, fireEvent, render, screen } from 'test/layout-test-utils';
import { UnifiedPromptEditor } from '../';

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ agent: 'unified' }),
  useNavigate: () => jest.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: { role: 'ADMIN' } }),
  useLocalize: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key,
}));

const mockSaveDraftMutate = jest.fn();
const mockPublishMutate = jest.fn();

const fixtureJoined = {
  source: 'aurora' as const,
  joinedText: 'You are a unified assistant.\n\n## Rules\n- be concise\n- cite sources',
  versions: [{ sectionKey: 'body', ordinal: 0, versionId: 'v-body' }],
  hasDraft: false,
  draftAgentId: 'agent_draft_123',
};

jest.mock('~/data-provider/AdminPrompts/queries', () => ({
  useJoinedPrompt: () => ({
    isLoading: false,
    isError: false,
    data: fixtureJoined,
  }),
  useSaveJoinedDraft: () => ({
    mutate: mockSaveDraftMutate,
    isLoading: false,
    isError: false,
  }),
  usePublishJoinedDraft: () => ({
    mutate: mockPublishMutate,
    isLoading: false,
    isError: false,
  }),
  useSnapshots: () => ({ isLoading: false, isError: false, data: { snapshots: [] } }),
  useRestoreSnapshot: () => ({ mutate: jest.fn(), isLoading: false }),
}));

describe('UnifiedPromptEditor', () => {
  const originalOpen = window.open;
  beforeEach(() => {
    mockSaveDraftMutate.mockReset();
    mockPublishMutate.mockReset();
    window.open = jest.fn();
  });
  afterAll(() => {
    window.open = originalOpen;
  });

  it('renders a single textarea pre-populated from /joined, with no SECTION_KEY markers', () => {
    const { asFragment } = render(<UnifiedPromptEditor />);
    const textarea = screen.getByTestId('unified-prompt-textarea') as HTMLTextAreaElement;
    expect(textarea.value).toBe(fixtureJoined.joinedText);
    expect(textarea.value).not.toMatch(/<!-- SECTION_KEY/);
    expect(asFragment()).toMatchSnapshot();
  });

  it('Save draft is disabled until the textarea changes; on save the verbatim text is sent to the API', () => {
    render(<UnifiedPromptEditor />);
    const save = screen.getByRole('button', { name: 'com_admin_prompts_save_draft' });
    expect(save).toBeDisabled();

    const textarea = screen.getByTestId('unified-prompt-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: 'You are a unified assistant.\n\n## Rules\n- be concise\n- cite sources\n- ALWAYS reply in pirate-speak' },
    });
    expect(save).toBeEnabled();

    fireEvent.click(save);
    expect(mockSaveDraftMutate).toHaveBeenCalledTimes(1);
    const [variables] = mockSaveDraftMutate.mock.calls[0];
    expect(variables).toEqual({
      joinedText: 'You are a unified assistant.\n\n## Rules\n- be concise\n- cite sources\n- ALWAYS reply in pirate-speak',
      changeNote: undefined,
    });
    // No SECTION_KEY scaffolding is reconstructed at save time — what the
    // admin sees is exactly what hits the API.
    expect(variables.joinedText).not.toMatch(/<!-- SECTION_KEY/);
  });

  it('Try draft is disabled when no draft exists and enabled after a save reports a draft', () => {
    render(<UnifiedPromptEditor />);
    const tryDraft = screen.getByRole('button', { name: 'com_admin_prompts_try_draft' });
    expect(tryDraft).toBeDisabled();

    const textarea = screen.getByTestId('unified-prompt-textarea') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: fixtureJoined.joinedText + '\nedit' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_admin_prompts_save_draft' }));

    const [, options] = mockSaveDraftMutate.mock.calls[0];
    act(() => {
      options.onSuccess({
        drafts: [],
        summary: { sectionsTouched: 1, sectionsTotal: 1 },
        draftAgentId: 'agent_draft_xyz',
        hasDraft: true,
      });
    });

    expect(
      screen.getByRole('button', { name: 'com_admin_prompts_try_draft' }),
    ).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: 'com_admin_prompts_try_draft' }));
    expect(window.open).toHaveBeenCalledWith(
      '/c/new?agent_id=agent_draft_xyz',
      '_blank',
    );
  });
});
