import { createRoot } from 'react-dom/client';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/lexend/400.css';
import '@fontsource/lexend/600.css';
import '@nudge/shared/tokens.css';
import './panel.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
