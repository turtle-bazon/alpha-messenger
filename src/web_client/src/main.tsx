import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './util/theme'; // применяет начальную тему до первого рендера
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
