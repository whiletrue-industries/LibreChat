import React from 'react';
import { render, screen, fireEvent } from 'test/layout-test-utils';
import { PromptEditor } from '../';

jest.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: ({ value, onChange }: { value: string; onChange?: (v: string) => void }) => (
    <textarea data-testid="monaco-editor" value={value} onChange={(e) => onChange?.(e.target.value)} />
  ),
  DiffEditor: () => <div data-testid="monaco-diff" />,
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useParams: () => ({ agent: 'unified', key: 'preamble' }),
  useNavigate: () => jest.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock('~/hooks', () => ({
  useAuthContext: () => ({ user: { role: 'ADMIN' } }),
  useLocalize: () => (key: string) => key,
}));

const mockPublishMutate = jest.fn();

const mockSectionsData = {
  sections: [
    {
      _id: 'v1',
      agentType: 'unified',
      sectionKey: 'preamble',
      ordinal: 0,
      headerText: '',
      body: 'original body',
      active: true,
      isDraft: false,
      createdAt: '2026-04-19T00:00:00Z',
      hasDraft: false,
    },
  ],
};
const mockVersionsData = { versions: [] };
const mockTestQuestionsData = { questions: [] };

jest.mock('~/data-provider/AdminPrompts/queries', () => ({
  useAdminPromptSections: () => ({ isLoading: false, data: mockSectionsData }),
  useAdminPromptVersions: () => ({ isLoading: false, data: mockVersionsData }),
  useSaveAdminPromptDraft: () => ({ mutate: jest.fn(), isLoading: false }),
  usePublishAdminPrompt: () => ({ mutate: mockPublishMutate, isLoading: false, isError: false }),
  usePreviewAdminPrompt: () => ({ mutate: jest.fn(), isLoading: false }),
  useRestoreAdminPrompt: () => ({ mutate: jest.fn(), isLoading: false }),
  useAdminPromptTestQuestions: () => ({ data: mockTestQuestionsData }),
  usePutAdminPromptTestQuestions: () => ({ mutate: jest.fn(), isLoading: false }),
  useAdminPromptVersionUsage: () => ({ isLoading: false, data: undefined }),
}));

describe('PromptEditor', () => {
  beforeEach(() => mockPublishMutate.mockReset());

  it('disables Publish until body is dirty AND change note is set', () => {
    render(<PromptEditor />);
    const publish = screen.getByRole('button', { name: 'com_admin_prompts_publish' });
    expect(publish).toBeDisabled();

    const editor = screen.getByTestId('monaco-editor') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'new body' } });
    expect(publish).toBeDisabled();

    const noteInput = screen.getByPlaceholderText('com_admin_prompts_change_note');
    fireEvent.change(noteInput, { target: { value: 'tightened' } });
    expect(publish).toBeEnabled();
  });

  it('calls publish mutation with expected variables', () => {
    render(<PromptEditor />);
    const editor = screen.getByTestId('monaco-editor') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'new body' } });
    const noteInput = screen.getByPlaceholderText('com_admin_prompts_change_note');
    fireEvent.change(noteInput, { target: { value: 'tightened' } });

    const publish = screen.getByRole('button', { name: 'com_admin_prompts_publish' });
    fireEvent.click(publish);

    expect(mockPublishMutate).toHaveBeenCalledTimes(1);
    const [variables] = mockPublishMutate.mock.calls[0];
    expect(variables).toEqual({
      agentType: 'unified',
      sectionKey: 'preamble',
      input: { parentVersionId: 'v1', body: 'new body', changeNote: 'tightened' },
    });
  });
});
