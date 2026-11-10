import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// 字体全部本地打包（SIL OFL）：ZCOOL KuaiLe 按 unicode-range 分片，只下载用到的字
import '@fontsource/zcool-kuaile/400.css'
import '@fontsource/baloo-2/latin-500.css'
import '@fontsource/baloo-2/latin-700.css'
import '@fontsource/baloo-2/latin-800.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/pages.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
