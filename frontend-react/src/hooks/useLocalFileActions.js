import { useRef, useState } from 'react';
import { api } from '@/api/client.js';

export function useLocalFileActions() {
  const busyRef = useRef(false);
  const [opening, setOpening] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);

  function clearMessage() { if (!busyRef.current) { setMessage(''); setError(false); } }

  async function openFile(url, label = '本地文件', target = 'file') {
    if (busyRef.current || !url) return;
    busyRef.current = true;
    setOpening(true);
    setError(false);
    setMessage(target === 'folder' ? '正在打开文件所在文件夹...' : `正在打开${label}...`);
    try {
      const result = await api.openLocalFile(url, target);
      if (result?.success !== true) throw new Error(result?.message || '打开本地文件失败。');
      setMessage(target === 'folder' ? '已请求系统打开文件所在文件夹。' : `已请求系统打开${label}。`);
    } catch (cause) {
      setError(true);
      setMessage(cause.message || '无法打开本地文件，请重试。');
    } finally {
      busyRef.current = false;
      setOpening(false);
    }
  }

  return { opening, message, error, openFile, clearMessage };
}
