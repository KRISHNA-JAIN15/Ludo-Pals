import '@fontsource/outfit/400.css';
import '@fontsource/outfit/500.css';
import '@fontsource/outfit/600.css';
import '@fontsource/outfit/700.css';
import '@fontsource/unbounded/700.css';
import '@fontsource/unbounded/800.css';
import '@fontsource/unbounded/900.css';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/global.css';
import './styles/game.css';
import './styles/screens.css';

createRoot(document.getElementById('root')!).render(<App />);
