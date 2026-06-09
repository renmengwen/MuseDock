import { useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell.jsx';
import { AiWorkspace } from './pages/AiWorkspace.jsx';
import { CrawlPage } from './pages/CrawlPage.jsx';
import { MediaWorkspace } from './pages/MediaWorkspace.jsx';
import { RecordsPage } from './pages/RecordsPage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';
import { getPersistentRouteState } from './utils/persistentRoutes.js';

function PersistentPages() {
  const location = useLocation();
  const [routeState, setRouteState] = useState(() => getPersistentRouteState(undefined, location.pathname, location.search));
  const isActive = page => routeState.activePage === page;

  useEffect(() => {
    setRouteState(previous => getPersistentRouteState(previous, location.pathname, location.search));
  }, [location.pathname, location.search]);

  return (
    <>
      <div hidden={!isActive('crawl')}>
        <CrawlPage routePlatform={routeState.crawlPlatform} />
      </div>
      <div hidden={!isActive('records')}>
        <RecordsPage routePlatform={routeState.recordsPlatform} />
      </div>
      <div hidden={!isActive('media')}>
        <MediaWorkspace routePlatform={routeState.mediaPlatform} routeAwemeId={routeState.mediaId} />
      </div>
      <div hidden={!isActive('ai')}>
        <AiWorkspace routeSearch={routeState.aiSearch} />
      </div>
      <div hidden={!isActive('settings')}>
        <SettingsPage />
      </div>
    </>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/crawl/douyin" replace />} />
        <Route path="crawl" element={<Navigate to="/crawl/douyin" replace />} />
        <Route path="records" element={<Navigate to="/records/douyin" replace />} />
        <Route path="*" element={<PersistentPages />} />
      </Route>
    </Routes>
  );
}
