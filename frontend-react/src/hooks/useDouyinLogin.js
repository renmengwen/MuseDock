import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';

export function useDouyinLogin() {
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginState, setLoginState] = useState({});
  const timerRef = useRef(null);

  useEffect(() => {
    api.getCookies().catch(() => {});
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  function pollLoginStatus() {
    if (timerRef.current) clearInterval(timerRef.current);
    let attempts = 0;
    timerRef.current = setInterval(async () => {
      attempts += 1;
      try {
        const json = await api.getDouyinLoginStatus();
        if (json.needVerify) {
          setLoginState({ waiting: true, hint: '请在 Chrome 中完成验证码，完成后保持窗口打开' });
          return;
        }
        if (json.loggedIn) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          setLoginState({ success: '登录成功，Cookie 已保存', hint: '可以关闭弹窗并开始搜索' });
          return;
        }
        if (attempts >= 120) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          setLoginState({ error: '登录超时，请重试', hint: '' });
        }
      } catch {
        if (attempts >= 120 && timerRef.current) {
          clearInterval(timerRef.current);
          timerRef.current = null;
        }
      }
    }, 1000);
  }

  async function startLogin() {
    setLoginOpen(true);
    setLoginState({ waiting: true, hint: '正在打开浏览器...' });
    try {
      const json = await api.startDouyinLogin();
      if (json.alreadyLoggedIn) {
        setLoginState({ success: '已检测到登录状态，无需重复扫码', hint: 'Cookie 已保存，可以直接搜索' });
        return;
      }
      if (json.needVerify) {
        setLoginState({ waiting: true, hint: '请在打开的 Chrome 中完成验证码' });
        pollLoginStatus();
        return;
      }
      setLoginState({ waiting: true, qrcode: json.qrcode, hint: '请使用抖音 App 扫码' });
      pollLoginStatus();
    } catch (error) {
      setLoginState({ error: error.message, hint: '登录启动失败' });
    }
  }

  return {
    loginOpen,
    loginState,
    setLoginOpen,
    startLogin,
  };
}
