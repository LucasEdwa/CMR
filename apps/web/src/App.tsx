import { createBrowserRouter, RouterProvider } from 'react-router'
import { Home } from '@/pages/Home'
import { NotFound } from '@/pages/NotFound'

const router = createBrowserRouter([
  { path: '/', element: <Home /> },
  { path: '*', element: <NotFound /> },
])

export default function App() {
  return <RouterProvider router={router} />
}
