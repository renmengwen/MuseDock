import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Settings2 } from 'lucide-react';

export function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const isSettingsRoute = location.pathname === '/settings';

  return (
    <>
      <header className="flex min-h-[64px] items-center justify-between gap-4 bg-gradient-to-br from-[#fe2c55] to-[#25f4ee] px-6 text-white">
        <div className="min-w-0">
          <h1 className="m-0 text-[22px] font-bold leading-tight">MuseDock</h1>
          <p className="mt-1 text-[13px] leading-tight text-white/90">内容抓取、素材准备和 AI 工作流的本地控制台</p>
        </div>
        {isSettingsRoute ? (
          <button
            className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-full border border-white/45 bg-white/15 px-3 text-sm font-bold text-white shadow-[0_8px_20px_rgba(15,23,42,.10)] backdrop-blur transition hover:-translate-y-0.5 hover:border-white/75 hover:shadow-[0_12px_28px_rgba(15,23,42,.16)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            type="button"
            onClick={() => navigate(-1)}
            aria-label="返回上一页"
          >
            <ArrowLeft size={18} />
            <span>返回</span>
          </button>
        ) : (
          <Link
            className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-full border border-white/45 bg-white/15 px-3 text-sm font-bold text-white shadow-[0_8px_20px_rgba(15,23,42,.10)] backdrop-blur transition hover:-translate-y-0.5 hover:border-white/75 hover:shadow-[0_12px_28px_rgba(15,23,42,.16)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            to="/settings"
            aria-label="打开设置"
          >
            <Settings2 size={18} />
            <span>设置</span>
          </Link>
        )}
      </header>

      <Outlet />
    </>
  );
}
