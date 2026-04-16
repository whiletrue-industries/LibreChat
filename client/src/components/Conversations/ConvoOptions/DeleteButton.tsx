import React, { useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDeleteConversationMutation } from '~/data-provider';
import {
  OGDialog,
  OGDialogTrigger,
  Label,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '~/components/ui';
import OGDialogTemplate from '~/components/ui/OGDialogTemplate';
import { TrashIcon } from '~/components/svg';
import { useLocalize, useNewConvo } from '~/hooks';

type DeleteButtonProps = {
  conversationId: string;
  retainView: () => void;
  title: string;
  className?: string;
  showDeleteDialog?: boolean;
  setShowDeleteDialog?: (value: boolean) => void;
};

export default function DeleteButton({
  conversationId,
  retainView,
  title,
  className = '',
  showDeleteDialog,
  setShowDeleteDialog,
}: DeleteButtonProps) {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { newConversation } = useNewConvo();
  const { conversationId: currentConvoId } = useParams();
  const [open, setOpen] = useState(false);
  const deleteConvoMutation = useDeleteConversationMutation({
    onSuccess: () => {
      if (currentConvoId === conversationId || currentConvoId === 'new') {
        newConversation();
        navigate('/c/new', { replace: true });
      }
      retainView();
    },
  });

  const confirmDelete = useCallback(() => {
    // `thread_id` was removed with the Responses-API migration; deleting
    // the LibreChat conversation in Mongo is sufficient — any associated
    // OpenAI Conversation is orphaned server-side and ages out per
    // OpenAI's retention policy.
    deleteConvoMutation.mutate({ conversationId, source: 'button' });
  }, [conversationId, deleteConvoMutation]);

  const dialogContent = (
    <OGDialogTemplate
      showCloseButton={false}
      title={localize('com_ui_delete_conversation')}
      className="z-[1000] max-w-[450px]"
      main={
        <>
          <div className="flex w-full flex-col items-center gap-2">
            <div className="grid w-full items-center gap-2">
              <Label htmlFor="dialog-confirm-delete" className="text-left text-sm font-medium">
                {localize('com_ui_delete_confirm')} <strong>{title}</strong>
              </Label>
            </div>
          </div>
        </>
      }
      selection={{
        selectHandler: confirmDelete,
        selectClasses:
          'bg-red-700 dark:bg-red-600 hover:bg-red-800 dark:hover:bg-red-800 text-white',
        selectText: localize('com_ui_delete'),
      }}
    />
  );

  if (showDeleteDialog !== undefined && setShowDeleteDialog !== undefined) {
    return (
      <OGDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        {dialogContent}
      </OGDialog>
    );
  }

  return (
    <OGDialog open={open} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <OGDialogTrigger asChild>
            <TooltipTrigger asChild>
              <button>
                <TrashIcon className="h-5 w-5" />
              </button>
            </TooltipTrigger>
          </OGDialogTrigger>
          <TooltipContent side="top" sideOffset={0} className={className}>
            {localize('com_ui_delete')}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      {dialogContent}
    </OGDialog>
  );
}
