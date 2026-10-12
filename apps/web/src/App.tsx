import { createBrowserRouter, RouterProvider } from 'react-router'
import { AppShell } from '@/components/layout/AppShell'
import { RequireAuth } from '@/components/layout/RequireAuth'
import { Home } from '@/pages/Home'
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

const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  { path: '/signup', element: <Signup /> },
  { path: '/check-email', element: <CheckEmail /> },
  { path: '/verify-email', element: <VerifyEmail /> },
  { path: '/forgot-password', element: <ForgotPassword /> },
  { path: '/reset-password', element: <ResetPassword /> },
  { path: '/invite/:token', element: <Invite /> },
  {
    element: <RequireAuth needsWorkspace={false} />,
    children: [{ path: '/onboarding', element: <Onboarding /> }],
  },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppShell />,
        children: [
          { path: '/', element: <Home /> },
          {
            path: '/settings',
            element: <SettingsLayout />,
            children: [
              { index: true, element: <WorkspaceSettings /> },
              { path: 'members', element: <Members /> },
              { path: 'profile', element: <Profile /> },
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
