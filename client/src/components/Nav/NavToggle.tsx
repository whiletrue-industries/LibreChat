import { TooltipAnchor } from '@librechat/client';
import { useIsRTL, useLocalize } from '~/hooks';
import { cn } from '~/utils';

const TRANSLATE_X = 260;

export default function NavToggle({
  onToggle,
  navVisible,
  isHovering,
  setIsHovering,
  side = 'left',
  className = '',
  translateX = true,
}: {
  onToggle: () => void;
  navVisible: boolean;
  isHovering: boolean;
  setIsHovering: (isHovering: boolean) => void;
  side?: 'left' | 'right';
  className?: string;
  translateX?: boolean;
}) {
  const localize = useLocalize();
  const isRTL = useIsRTL();
  const transition = {
    transition: 'transform 0.3s ease, opacity 0.2s ease',
  };

  const rotationDegree = 15;
  const rotation = isHovering || !navVisible ? `${rotationDegree}deg` : '0deg';
  const topBarRotation = side === 'right' ? `-${rotation}` : rotation;
  const bottomBarRotation = side === 'right' ? rotation : `-${rotation}`;

  let sidebarLabel;
  let actionKey;

  if (side === 'left') {
    sidebarLabel = localize('com_ui_chat_history');
  } else {
    sidebarLabel = localize('com_nav_control_panel');
  }

  if (navVisible) {
    actionKey = 'com_ui_close_var';
  } else {
    actionKey = 'com_ui_open_var';
  }

  const ariaDescription = localize(actionKey, { 0: sidebarLabel });

  const shouldTranslate = navVisible && translateX;
  const translatePx = (() => {
    if (!shouldTranslate) {
      return 0;
    }
    const directionSign = side === 'right' ? -1 : 1;
    const rtlSign = isRTL ? -1 : 1;
    return directionSign * rtlSign * TRANSLATE_X;
  })();
  const rotateDeg = navVisible ? 0 : 180;

  return (
    <div
      className={cn(className, 'transition-transform')}
      style={{
        transform: `translateX(${translatePx}px) translateY(-50%) rotate(${rotateDeg}deg)`,
      }}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
    >
      <TooltipAnchor
        side={side === 'right' ? 'left' : 'right'}
        aria-label={ariaDescription}
        aria-expanded={navVisible}
        aria-controls={side === 'left' ? 'chat-history-nav' : 'controls-nav'}
        id={`toggle-${side}-nav`}
        onClick={onToggle}
        role="button"
        description={ariaDescription}
        className="flex items-center justify-center"
        tabIndex={0}
      >
        <span className="" data-state="closed">
          <div
            className="flex h-[72px] w-8 items-center justify-center"
            style={{ ...transition, opacity: isHovering ? 1 : 0.25 }}
          >
            <div className="flex h-6 w-6 flex-col items-center">
              {/* Top bar */}
              <div
                className="h-3 w-1 rounded-full bg-black dark:bg-white"
                style={{
                  ...transition,
                  transform: `translateY(0.15rem) rotate(${topBarRotation}) translateZ(0px)`,
                }}
              />
              {/* Bottom bar */}
              <div
                className="h-3 w-1 rounded-full bg-black dark:bg-white"
                style={{
                  ...transition,
                  transform: `translateY(-0.15rem) rotate(${bottomBarRotation}) translateZ(0px)`,
                }}
              />
            </div>
          </div>
        </span>
      </TooltipAnchor>
    </div>
  );
}
