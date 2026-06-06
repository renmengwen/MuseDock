import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.jsx';
import { AiWorkspace } from './pages/AiWorkspace.jsx';
import { CrawlPage } from './pages/CrawlPage.jsx';
import { MediaWorkspace } from './pages/MediaWorkspace.jsx';
import { RecordsPage } from './pages/RecordsPage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/crawl/douyin" replace />} />
        <Route path="crawl" element={<Navigate to="/crawl/douyin" replace />} />
        <Route path="crawl/:platform" element={<CrawlPage />} />
        <Route path="records" element={<Navigate to="/records/douyin" replace />} />
        <Route path="records/:platform" element={<RecordsPage />} />
        <Route path="media" element={<MediaWorkspace />} />
        <Route path="media/:platform/:id" element={<MediaWorkspace />} />
        <Route path="ai" element={<AiWorkspace />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/crawl/douyin" replace />} />
      </Route>
    </Routes>
  );
}
