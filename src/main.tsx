import React from 'react';
import ReactDOM from 'react-dom/client';
import { ThemeProvider, TooltipProvider, ToastProvider, ErrorBoundary } from 'haui';
import 'haui/styles.css';
import './styles.css';
import { App } from './ui/App';
import { CaptureToolbar } from './ui/CaptureToolbar';
import type { Bridge } from './core/types';
declare global { interface Window { tokenBalance: Bridge; } }
const captureId=new URLSearchParams(location.search).get('capture');
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ThemeProvider storageKey="123tokenbalance.theme"><TooltipProvider><ToastProvider><ErrorBoundary>{captureId?<CaptureToolbar id={captureId}/>:<App />}</ErrorBoundary></ToastProvider></TooltipProvider></ThemeProvider></React.StrictMode>);
