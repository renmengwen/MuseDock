import { Link, Outlet, useLocation } from 'react-router-dom';
import { ArrowLeft, Settings2 } from 'lucide-react';

export function AppShell() {
  const location = useLocation();
  const isSettingsRoute = location.pathname === '/settings';

  return (
    <>
      <header className="header">
        <div className="headerText">
          <h1>MuseDock</h1>
          <p>本地视频生产控制台</p>
        </div>
        {isSettingsRoute ? (
          <Link className="creativeHeaderSettings" to="/creative">
            <ArrowLeft size={16} aria-hidden="true" />
            <span>返回</span>
          </Link>
        ) : (
          <Link className="creativeHeaderSettings" to="/settings">
            <Settings2 size={16} aria-hidden="true" />
            <span>设置</span>
          </Link>
        )}
      </header>
      <Outlet />
    </>
  );
}
