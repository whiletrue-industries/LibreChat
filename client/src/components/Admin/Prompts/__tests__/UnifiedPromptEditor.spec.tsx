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
  joinedText:
    '<!-- SECTION_KEY: preamble -->\noriginal preamble\n\n<!-- SECTION_KEY: rules -->\noriginal rules\n',
  versions: [
    { sectionKey: 'preamble', ordinal: 0, versionId: 'v-pre' },
    { sectionKey: 'rules', ordinal: 1, versionId: 'v-rul' },
  ],
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
  useToolOverrides: () => ({
    isLoading: false,
    isError: false,
    data: { tools: [] },
  }),
  useToolOverrideVersions: () => ({
    isLoading: false,
    isError: false,
    data: { versions: [] },
  }),
  useSaveToolOverrideDraft: () => ({ mutate: jest.fn(), isLoading: false, isError: false }),
  usePublishToolOverride: () => ({ mutate: jest.fn(), isLoading: false, isError: false }),
  useClearToolOverride: () => ({ mutate: jest.fn(), isLoading: false, isError: false }),
  useRestoreToolOverride: () => ({ mutate: jest.fn(), isLoading: false, isError: false }),
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

  it('renders one textarea per section, marker-free, pre-populated from /joined', () => {
    const { asFragment } = render(<UnifiedPromptEditor />);
    const preamble = screen.getByTestId('section-textarea-preamble') as HTMLTextAreaElement;
    const rules = screen.getByTestId('section-textarea-rules') as HTMLTextAreaElement;
    expect(preamble.value).toBe('original preamble');
    expect(rules.value).toBe('original rules');
    // SECTION_KEY markers are an internal serialization artifact and must
    // never bleed into the user-facing view.
    expect(preamble.value).not.toMatch(/<!-- SECTION_KEY/);
    expect(rules.value).not.toMatch(/<!-- SECTION_KEY/);
    expect(asFragment()).toMatchSnapshot();
  });

  it('Save draft is disabled until a section changes; on save the joined text is reconstructed with markers', () => {
    render(<UnifiedPromptEditor />);
    const save = screen.getByRole('button', { name: 'com_admin_prompts_save_draft' });
    expect(save).toBeDisabled();

    const preamble = screen.getByTestId('section-textarea-preamble') as HTMLTextAreaElement;
    fireEvent.change(preamble, { target: { value: 'updated preamble' } });
    expect(save).toBeEnabled();

    fireEvent.click(save);
    expect(mockSaveDraftMutate).toHaveBeenCalledTimes(1);
    const [variables] = mockSaveDraftMutate.mock.calls[0];
    expect(variables).toEqual({
      joinedText:
        '<!-- SECTION_KEY: preamble -->\n\nupdated preamble\n\n---\n\n<!-- SECTION_KEY: rules -->\n\noriginal rules',
      changeNote: undefined,
    });
  });

  it('Try draft is disabled when no draft exists and enabled after a save reports a draft', () => {
    render(<UnifiedPromptEditor />);
    const tryDraft = screen.getByRole('button', { name: 'com_admin_prompts_try_draft' });
    expect(tryDraft).toBeDisabled();

    const rules = screen.getByTestId('section-textarea-rules') as HTMLTextAreaElement;
    fireEvent.change(rules, { target: { value: 'edited rules' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_admin_prompts_save_draft' }));

    const [, options] = mockSaveDraftMutate.mock.calls[0];
    act(() => {
      options.onSuccess({
        drafts: [],
        summary: { sectionsTouched: 1, sectionsTotal: 2 },
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
