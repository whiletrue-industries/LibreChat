import { Navigate } from 'react-router-dom';
import {
  PromptsView,
  PromptForm,
  CreatePromptForm,
  EmptyPromptPreview,
} from '~/components/Prompts';
import { FeedbackDashboard } from '~/components/Admin/Feedback';
import {
  PromptsDashboard,
  PromptEditor,
  PromptSectionList,
  UnifiedPromptEditor,
} from '~/components/Admin/Prompts';
import { SourcesDashboard } from '~/components/Admin/Sources';
import { SanityDashboard } from '~/components/Admin/Sanity';
import DashboardRoute from './Layouts/Dashboard';

const dashboardRoutes = {
  path: 'd/*',
  element: <DashboardRoute />,
  children: [
    /*
    {
      element: <FileDashboardView />,
      children: [
        {
          index: true,
          element: <EmptyVectorStorePreview />,
        },
        {
          path: ':vectorStoreId',
          element: <DataTableFilePreview />,
        },
      ],
    },
    {
      path: 'files/*',
      element: <FilesListView />,
      children: [
        {
          index: true,
          element: <EmptyFilePreview />,
        },
        {
          path: ':fileId',
          element: <FilePreview />,
        },
      ],
    },
    {
      path: 'vector-stores/*',
      element: <VectorStoreView />,
      children: [
        {
          index: true,
          element: <EmptyVectorStorePreview />,
        },
        {
          path: ':vectorStoreId',
          element: <VectorStorePreview />,
        },
      ],
    },
    */
    {
      path: 'prompts/*',
      element: <PromptsView />,
      children: [
        {
          index: true,
          element: <EmptyPromptPreview />,
        },
        {
          path: 'new',
          element: <CreatePromptForm />,
        },
        {
          path: ':promptId',
          element: <PromptForm />,
        },
      ],
    },
    {
      path: 'feedback',
      element: <FeedbackDashboard />,
    },
    {
      path: 'agent-prompts',
      element: <PromptsDashboard />,
    },
    {
      path: 'agent-prompts/:agent',
      element: <UnifiedPromptEditor />,
    },
    {
      path: 'agent-prompts/:agent/sections',
      element: <PromptSectionList />,
    },
    {
      path: 'agent-prompts/:agent/sections/:key',
      element: <PromptEditor />,
    },
    {
      path: 'sources',
      element: <SourcesDashboard />,
    },
    {
      path: 'sanity',
      element: <SanityDashboard />,
    },
    {
      path: '*',
      element: <Navigate to="/d/files" replace={true} />,
    },
  ],
};

export default dashboardRoutes;
