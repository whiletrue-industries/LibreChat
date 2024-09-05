import React from 'react';
import { Clock4 } from 'lucide-react';
import { cn } from '~/utils';
import { useRecoilValue } from 'recoil';
import store from '~/store';

export interface MentionItemProps {
  name: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  index: number;
  type?: 'prompt' | 'mention' | 'add-convo';
  icon?: React.ReactNode;
  isActive?: boolean;
  description?: string;
}

export default function MentionItem({
  name,
  onClick,
  index,
  icon,
  isActive,
  description,
  type = 'mention',
}: MentionItemProps) {
  const chatDirection = useRecoilValue(store.chatDirection).toLowerCase();
  const isRTL = chatDirection === 'rtl';

  return (
    <button tabIndex={index} onClick={onClick} id={`${type}-item-${index}`} className="w-full">
      <div
        className={cn(
          'text-token-text-primary bg-token-main-surface-secondary group flex h-10 items-center gap-2 rounded-lg px-2 text-sm font-medium hover:bg-surface-secondary',
          isActive ? 'bg-surface-active' : 'bg-transparent',
        )}
      >
        <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center">{icon}</div>
        <div className="flex min-w-0 flex-grow items-center justify-between">
          <div className="truncate">
            <span className="font-medium">{name}</span>
            {description ? (
              <span
                className={cn(
                  'text-token-text-tertiary text-sm font-light',
                  isRTL ? 'mr-2' : 'ml-2',
                )}
              >
                {description}
              </span>
            ) : null}
          </div>
          <Clock4 size={16} className={cn('flex-shrink-0', isRTL ? 'mr-2' : 'ml-2')} />
        </div>
      </div>
    </button>
  );
}
