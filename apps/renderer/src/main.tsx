import React from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { APP_LOGO_URL } from './branding';

const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]') ?? document.createElement('link');
favicon.rel = 'icon';
favicon.type = 'image/svg+xml';
favicon.href = APP_LOGO_URL;
if (!favicon.isConnected) document.head.append(favicon);

const container = document.getElementById('root');
if (!container) throw new Error('#root missing from index.html');
createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
