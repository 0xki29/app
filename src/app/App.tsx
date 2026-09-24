import { WorkspaceScreen } from '../workspace/WorkspaceScreen'
import { hrefFor, useRoute } from './router'

/**
 * The app shell: picks the screen for the current route (router.ts). Screens own their layout;
 * the shell adds nothing around them, so the writing workspace keeps the whole viewport.
 */
export function App() {
  const route = useRoute()
  switch (route.id) {
    case 'practice':
      return <WorkspaceScreen />
    case 'not-found':
      return <NotFound />
  }
}

function NotFound() {
  return (
    <main className="error-page">
      <h1 className="error-page__title">Không tìm thấy trang</h1>
      <p className="error-page__text">Địa chỉ này không có trong ứng dụng.</p>
      <a className="btn btn--primary" href={hrefFor('/')}>
        Về trang luyện viết
      </a>
    </main>
  )
}
