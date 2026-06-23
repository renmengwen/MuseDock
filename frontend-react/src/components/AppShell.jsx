import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Settings2 } from 'lucide-react';

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const isSettingsRoute = location.pathname === '/settings';

  return (
    <>
      <header className="header">
        <div className="headerText">
          <h1>MuseDock</h1>
          <p>内容抓取、素材准备和 AI 工作流的本地控制台</p>
        </div>
        {isSettingsRoute ? (
          <button className="creativeHeaderSettings" type="button" onClick={() => navigate(-1)} aria-label="返回上一页">
            <ArrowLeft size={18} />
            <span>返回</span>
          </button>
        ) : (
          <Link className="creativeHeaderSettings" to="/settings" aria-label="打开设置">
            <Settings2 size={18} />
            <span>设置</span>
          </Link>
        )}
      </header>

      <Outlet />
    </>
  );
}
