import { NavLink } from 'react-router-dom';

function tabClass({ isActive }) {
  return isActive ? 'active' : '';
}

export function PlatformTabs({ base }) {
  return (
    <div className="subTabs">
      <NavLink className={tabClass} to={`/${base}/douyin`}>抖音视频</NavLink>
      <NavLink className={tabClass} to={`/${base}/xhs`}>小红书笔记</NavLink>
    </div>
  );
}
