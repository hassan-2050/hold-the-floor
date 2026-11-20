import { createRoot } from 'react-dom/client';
import '@fontsource/atkinson-hyperlegible-next/400.css';
import '@fontsource/atkinson-hyperlegible-next/700.css';
import '@fontsource/atkinson-hyperlegible-mono/400.css';
import '@fontsource/atkinson-hyperlegible-mono/700.css';
import './styles/base.css';
import { App } from './app/App';

// No StrictMode: its double-run of effects in development would open the
// camera twice.
createRoot(document.getElementById('root')!).render(<App />);
