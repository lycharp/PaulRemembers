import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { UpdateBar } from './components/UpdateBar';
import { DailyBackupBar } from './components/DailyBackupBar';
import { IconReminder } from './components/People';
import { startCloud } from './cloud/cloud';
import './styles.css';

startCloud();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <UpdateBar />
    <DailyBackupBar />
    <IconReminder />
  </StrictMode>
);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
