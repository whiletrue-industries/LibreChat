import { DiffEditor } from '@monaco-editor/react';

export interface PromptDiffProps {
  current: string;
  draft: string;
  readOnly?: boolean;
  height?: string;
}

export default function PromptDiff({
  current,
  draft,
  readOnly = true,
  height = '40vh',
}: PromptDiffProps) {
  return (
    <div className="rounded border border-border-medium">
      <DiffEditor
        height={height}
        language="markdown"
        theme="vs"
        original={current}
        modified={draft}
        options={{
          readOnly,
          renderSideBySide: true,
          wordWrap: 'on',
          fontSize: 15,
          lineHeight: 22,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
        }}
      />
    </div>
  );
}
