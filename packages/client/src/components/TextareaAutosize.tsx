import { forwardRef, useLayoutEffect, useState } from 'react';
import ReactTextareaAutosize from 'react-textarea-autosize';
import type { TextareaAutosizeProps } from 'react-textarea-autosize';

type BaseTextareaAutosizeProps = Omit<TextareaAutosizeProps, 'aria-label' | 'aria-labelledby'>;

export type TextareaAutosizePropsWithAria =
  | (BaseTextareaAutosizeProps & {
      'aria-label': string;
      'aria-labelledby'?: never;
    })
  | (BaseTextareaAutosizeProps & {
      'aria-labelledby': string;
      'aria-label'?: never;
    });

export const TextareaAutosize = forwardRef<HTMLTextAreaElement, TextareaAutosizePropsWithAria>(
  (props, ref) => {
    // Force RTL on the chat input: this is a Hebrew-only bot. The previous
    // `dir={chatDirectionAtom}` honored a per-user localStorage preference,
    // but pre-existing users had `LTR` stuck from before our default flip,
    // and there is no scenario in this fork where LTR input is wanted.
    // Hardcoding here also leaves the atom intact for other UI (message
    // bubble alignment, sidebar) so user-controlled direction still works
    // for those surfaces if Settings → Chat is exposed.
    const [, setIsRerendered] = useState(false);
    useLayoutEffect(() => setIsRerendered(true), []);
    return <ReactTextareaAutosize dir="rtl" {...props} ref={ref} />;
  },
);
