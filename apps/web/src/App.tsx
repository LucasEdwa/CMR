import { createBrowserRouter, RouterProvider } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { RequireAuth } from '@/components/layout/RequireAuth'
import { Home } from '@/pages/Home'
import { TasksPage } from '@/pages/tasks/TasksPage'
import { ImportPage } from '@/pages/import/ImportPage'
import { TwoFactorChallenge } from '@/pages/auth/TwoFactorChallenge'
import { SetupTwoFactor } from '@/pages/auth/SetupTwoFactor'
import { DuplicatesPage } from '@/pages/contacts/DuplicatesPage'
import { TrashPage } from '@/pages/TrashPage'
import { ContactsPage } from '@/pages/contacts/ContactsPage'
import { ContactDetail } from '@/pages/contacts/ContactDetail'
import { CompaniesPage } from '@/pages/companies/CompaniesPage'
import { CompanyDetail } from '@/pages/companies/CompanyDetail'
import { Invite } from '@/pages/Invite'
import { NotFound } from '@/pages/NotFound'
import { Onboarding } from '@/pages/Onboarding'
import { CheckEmail } from '@/pages/auth/CheckEmail'
import { ForgotPassword } from '@/pages/auth/ForgotPassword'
import { Login } from '@/pages/auth/Login'
import { ResetPassword } from '@/pages/auth/ResetPassword'
import { Signup } from '@/pages/auth/Signup'
import { VerifyEmail } from '@/pages/auth/VerifyEmail'
import { Members } from '@/pages/settings/Members'
import { Profile } from '@/pages/settings/Profile'
import { SettingsLayout } from '@/pages/settings/SettingsLayout'
import { WorkspaceSettings } from '@/pages/settings/WorkspaceSettings'
import { PipelineSettings } from '@/pages/settings/PipelineSettings'
import { PicklistSettings } from '@/pages/settings/PicklistSettings'
import { AuditLog } from '@/pages/settings/AuditLog'
import { DealsPage } from '@/pages/deals/DealsPage'
import { DealDetail } from '@/pages/deals/DealDetail'

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/signup', element: <Signup /> },
  { path: '/check-email', element: <CheckEmail /> },
  { path: '/verify-email', element: <VerifyEmail /> },
  { path: '/forgot-password', element: <ForgotPassword /> },
  { path: '/reset-password', element: <ResetPassword /> },
  { path: '/login/2fa', element: <TwoFactorChallenge /> },
  { path: '/invite/:token', element: <Invite /> },
  {
    element: <RequireAuth needsWorkspace={false} />,
    children: [
      { path: '/onboarding', element: <Onboarding /> },
      { path: '/setup-2fa', element: <SetupTwoFactor /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <Home /> },
          { path: '/contacts', element: <ContactsPage /> },
          { path: '/contacts/duplicates', element: <DuplicatesPage /> },
          { path: '/contacts/:id', element: <ContactDetail /> },
          { path: '/companies', element: <CompaniesPage /> },
          { path: '/companies/:id', element: <CompanyDetail /> },
          { path: '/deals', element: <DealsPage /> },
          { path: '/deals/:id', element: <DealDetail /> },
          { path: '/tasks', element: <TasksPage /> },
          { path: '/import', element: <ImportPage /> },
          { path: '/trash', element: <TrashPage /> },
          {
            path: '/settings',
            element: <SettingsLayout />,
            children: [
              { index: true, element: <WorkspaceSettings /> },
              { path: 'members', element: <Members /> },
              { path: 'profile', element: <Profile /> },
              { path: 'pipelines', element: <PipelineSettings /> },
              { path: 'lists', element: <PicklistSettings /> },
              { path: 'audit', element: <AuditLog /> },
            ],
          },
        ],
      },
    ],
  },
  { path: '*', element: <NotFound /> },
])

export default function App() {
  return <RouterProvider router={router} />
}
