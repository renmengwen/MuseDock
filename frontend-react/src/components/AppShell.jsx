import { NavLink, Outlet } from 'react-router-dom';

function navClass({ isActive }) {
  return isActive ? 'active' : '';
}

export function AppShell() {
  return (
    <>
      <header className="header">
        <h1>MuseDock</h1>
        <p>内容抓取、素材准备和 AI 工作流的本地控制台</p>
      </header>

      <nav className="tabs">
        <NavLink className={navClass} to="/creative">一键创作</NavLink>
        <NavLink className={navClass} to="/crawl/douyin">内容抓取</NavLink>
        <NavLink className={navClass} to="/records/douyin">抓取记录</NavLink>
        <NavLink className={navClass} to="/media">素材工作台</NavLink>
        {/* <NavLink className={navClass} to="/ai">AI 工作台</NavLink> */}
        <NavLink className={navClass} to="/hyperframes-freeform">高级成片</NavLink>
        <NavLink className={navClass} to="/settings">设置</NavLink>
      </nav>

      <Outlet />
    </>
  );
}
