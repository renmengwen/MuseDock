import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell.jsx';
import { CreativeEditorPage } from './pages/CreativeEditorPage.jsx';
import { OneClickCreativePage } from './pages/OneClickCreativePage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/creative" replace />} />
        <Route path="creative" element={<OneClickCreativePage />} />
        <Route path="creative/:workflowId" element={<OneClickCreativePage />} />
        <Route path="editor/:workflowId" element={<CreativeEditorPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/creative" replace />} />
      </Route>
    </Routes>
  );
}
