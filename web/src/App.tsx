import { createBrowserRouter, Navigate, Outlet, RouterProvider, ScrollRestoration, useLocation } from 'react-router-dom'
import { Toasts, NotFound } from './components/ui'
import { AppProvider } from './lib/app'
import { DishPage } from './pages/DishPage'
import { EditPage } from './pages/EditPage'
import { HomePage } from './pages/HomePage'
import { KitchenLogin, KitchenOnly } from './pages/Kitchen'
import { SettingsPage } from './pages/SettingsPage'
import { UploadPage } from './pages/UploadPage'

function Shell() {
  const loc = useLocation()
  return (
    <>
      {/* key 变化触发页面进场动画 */}
      <div className="route" key={loc.pathname}>
        <Outlet />
      </div>
      <Toasts />
      <ScrollRestoration />
    </>
  )
}

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/dishes/:id', element: <DishPage /> },
      { path: '/kitchen', element: <Navigate to="/kitchen/upload" replace /> },
      { path: '/kitchen/login', element: <KitchenLogin /> },
      { path: '/kitchen/upload', element: <KitchenOnly><UploadPage /></KitchenOnly> },
      { path: '/kitchen/dishes/:id/edit', element: <KitchenOnly><EditPage /></KitchenOnly> },
      { path: '/kitchen/settings', element: <KitchenOnly><SettingsPage /></KitchenOnly> },
      { path: '*', element: <NotFound /> },
    ],
  },
])

export default function App() {
  return (
    <AppProvider>
      <RouterProvider router={router} />
    </AppProvider>
  )
}
