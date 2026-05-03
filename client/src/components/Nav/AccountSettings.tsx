import { memo, useRef } from 'react';
import * as Menu from '@ariakit/react/menu';
import { useNavigate } from 'react-router-dom';
import { BarChart3, Database, FileText, LogOut } from 'lucide-react';
import { SystemRoles } from 'librechat-data-provider';
import { LinkIcon, DropdownMenuSeparator, Avatar } from '@librechat/client';
import { useGetStartupConfig, useGetUserBalance } from '~/data-provider';
import { useAuthContext } from '~/hooks/AuthContext';
import { useLocalize } from '~/hooks';

function AccountSettings() {
  const localize = useLocalize();
  const navigate = useNavigate();
  const { user, isAuthenticated, logout } = useAuthContext();
  const isAdmin = user?.role === SystemRoles.ADMIN;
  const { data: startupConfig } = useGetStartupConfig();
  const balanceQuery = useGetUserBalance({
    enabled: !!isAuthenticated && startupConfig?.balance?.enabled,
  });
  const accountSettingsButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <Menu.MenuProvider>
      <Menu.MenuButton
        ref={accountSettingsButtonRef}
        aria-label={localize('com_nav_account_settings')}
        data-testid="nav-user"
        className="mt-text-sm flex h-auto w-full items-center gap-2 rounded-xl p-2 text-sm transition-all duration-200 ease-in-out hover:bg-surface-active-alt aria-[expanded=true]:bg-surface-active-alt"
      >
        <div className="-ms-0.9 -mt-0.8 h-8 w-8 flex-shrink-0">
          <div className="relative flex">
            <Avatar user={user} size={32} />
          </div>
        </div>
        <div
          className="mt-2 grow overflow-hidden text-ellipsis whitespace-nowrap text-start text-text-primary"
          style={{ marginTop: '0', marginInlineStart: '0' }}
        >
          {user?.name ?? user?.username ?? localize('com_nav_user')}
        </div>
      </Menu.MenuButton>
      <Menu.Menu
        className="account-settings-popover popover-ui z-[125] w-[305px] rounded-lg md:w-[244px]"
        style={{
          transformOrigin: 'bottom',
          translate: '0 -4px',
        }}
      >
        <div className="text-token-text-secondary ms-3 me-2 py-2 text-sm" role="note">
          {user?.email ?? localize('com_nav_user')}
        </div>
        <DropdownMenuSeparator />
        {startupConfig?.balance?.enabled === true && balanceQuery.data != null && (
          <>
            <div className="text-token-text-secondary ms-3 me-2 py-2 text-sm" role="note">
              {localize('com_nav_balance')}:{' '}
              {new Intl.NumberFormat().format(Math.round(balanceQuery.data.tokenCredits))}
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        {startupConfig?.helpAndFaqURL !== '/' && (
          <Menu.MenuItem
            onClick={() => window.open(startupConfig?.helpAndFaqURL, '_blank')}
            className="select-item text-sm"
          >
            <LinkIcon aria-hidden="true" />
            {localize('com_nav_help_faq')}
          </Menu.MenuItem>
        )}
        {isAdmin && (
          <Menu.MenuItem
            onClick={() => navigate('/d/feedback')}
            className="select-item text-sm"
          >
            <BarChart3 className="icon-md" aria-hidden="true" />
            {localize('com_admin_feedback_title')}
          </Menu.MenuItem>
        )}
        {isAdmin && (
          <Menu.MenuItem
            onClick={() => navigate('/d/agent-prompts')}
            className="select-item text-sm"
          >
            <FileText className="icon-md" aria-hidden="true" />
            {localize('com_admin_prompts_title')}
          </Menu.MenuItem>
        )}
        {isAdmin && (
          <Menu.MenuItem
            onClick={() => navigate('/d/sources')}
            className="select-item text-sm"
          >
            <Database className="icon-md" aria-hidden="true" />
            {localize('com_admin_sources_title')}
          </Menu.MenuItem>
        )}
        <DropdownMenuSeparator />
        <Menu.MenuItem onClick={() => logout()} className="select-item text-sm">
          <LogOut className="icon-md" aria-hidden="true" />
          {localize('com_nav_log_out')}
        </Menu.MenuItem>
      </Menu.Menu>
    </Menu.MenuProvider>
  );
}

export default memo(AccountSettings);
