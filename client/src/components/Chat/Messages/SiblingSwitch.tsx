import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { TMessageProps } from '~/common';
import { useIsRTL, useLocalize } from '~/hooks';
import { cn } from '~/utils';

type TSiblingSwitchProps = Pick<TMessageProps, 'siblingIdx' | 'siblingCount' | 'setSiblingIdx'>;

export default function SiblingSwitch({
  siblingIdx,
  siblingCount,
  setSiblingIdx,
}: TSiblingSwitchProps) {
  const localize = useLocalize();
  const isRTL = useIsRTL();

  if (siblingIdx === undefined) {
    return null;
  } else if (siblingCount === undefined) {
    return null;
  }

  const previous = () => {
    setSiblingIdx && setSiblingIdx(siblingIdx - 1);
  };

  const next = () => {
    setSiblingIdx && setSiblingIdx(siblingIdx + 1);
  };

  const buttonStyle = cn(
    'hover-button rounded-lg p-1.5 text-text-secondary-alt',
    'hover:text-text-primary hover:bg-surface-hover',
    'md:group-hover:visible md:group-focus-within:visible md:group-[.final-completion]:visible',
    'focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-white focus-visible:outline-none',
  );

  const PrevIcon = isRTL ? ChevronRight : ChevronLeft;
  const NextIcon = isRTL ? ChevronLeft : ChevronRight;

  return siblingCount > 1 ? (
    <nav
      className="visible flex items-center justify-center gap-2 self-center pt-0 text-xs"
      aria-label={localize('com_ui_sibling_message_nav')}
    >
      <button
        className={buttonStyle}
        type="button"
        onClick={previous}
        disabled={siblingIdx == 0}
        aria-label={localize('com_ui_sibling_message_prev')}
        aria-disabled={siblingIdx == 0}
      >
        <PrevIcon size="19" aria-hidden="true" />
      </button>
      <span
        className="flex-shrink-0 flex-grow tabular-nums"
        aria-live="polite"
        aria-atomic="true"
        role="status"
      >
        {siblingIdx + 1} / {siblingCount}
      </span>
      <button
        className={buttonStyle}
        type="button"
        onClick={next}
        disabled={siblingIdx == siblingCount - 1}
        aria-label={localize('com_ui_sibling_message_next')}
        aria-disabled={siblingIdx == siblingCount - 1}
      >
        <NextIcon size="19" aria-hidden="true" />
      </button>
    </nav>
  ) : null;
}
