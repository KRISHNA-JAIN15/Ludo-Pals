import '@fontsource/outfit/400.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import '@fontsource/unbounded/700.css';
import '@fontsource/unbounded/800.css';
import '@fontsource/unbounded/900.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles/global.css';
import './styles/game.css';
import './styles/chat.css';
import './styles/screens.css';

// Sheets are sized to the visible viewport, which shrinks when the on-screen keyboard opens.
const viewport = window.visualViewport;
if (viewport) {
  const sync = () => {
    document.documentElement.style.setProperty('--vvh', `${viewport.height}px`);
    document.documentElement.style.setProperty('--vvt', `${viewport.offsetTop}px`);
  };
  viewport.addEventListener('resize', sync);
  viewport.addEventListener('scroll', sync);
  sync();
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
