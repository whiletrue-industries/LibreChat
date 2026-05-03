import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { QueryKeys } from 'librechat-data-provider';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthContext, usePreviousLocation } from '~/hooks';
import { DashboardContext } from '~/Providers';
import { Nav } from '~/components/Nav';
import store from '~/store';

export default function DashboardRoute() {
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuthContext();
  const prevLocationRef = usePreviousLocation();
  const clearConvoState = store.useClearConvoState();
  const [prevLocationPath, setPrevLocationPath] = useState('');

  // Sidebar visibility — initialised expanded by default on dashboard
  // entry so admins always have a way to navigate between Feedback
  // Insights / Data Sources / Prompt Management without going back to
  // the chat. The user-controllable toggle still works (Nav writes
  // `navVisible` to localStorage on toggle), so this only controls the
  // *default* state — and we deliberately do NOT honour that key here:
  // a chat-side preference to hide the sidebar shouldn't carry over to
  // admin pages where there's no other navigation. Closes Monday item
  // 2881650565.
  const [navVisible, setNavVisible] = useState(true);

  useEffect(() => {
    setPrevLocationPath(prevLocationRef.current?.pathname || '');
  }, [prevLocationRef]);

  useEffect(() => {
    queryClient.removeQueries([QueryKeys.messages, 'new']);
    clearConvoState();
  }, [queryClient, clearConvoState]);

  if (!isAuthenticated) {
    return null;
  }

  return (
    <DashboardContext.Provider value={{ prevLocationPath }}>
      <div className="flex h-screen w-full">
        <Nav navVisible={navVisible} setNavVisible={setNavVisible} />
        <div className="relative flex h-full max-w-full flex-1 flex-col overflow-hidden">
          <Outlet context={{ navVisible, setNavVisible }} />
        </div>
      </div>
    </DashboardContext.Provider>
  );
}
