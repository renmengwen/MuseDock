import { useEffect, useRef, useState } from 'react';
import { Activity, List, Loader2 } from 'lucide-react';
import { api } from '../../api/client.js';
import { Status } from '../Status.jsx';
import { Button } from '@/components/ui/button';

async function copyModelIdToClipboard(modelId) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(modelId); return; } catch { /* 权限受限时尝试选区复制。 */ }
  }
  const previousFocus = document.activeElement;
  const textarea = document.createElement('textarea');
  textarea.value = modelId;
  textarea.setAttribute('readonly', '');
  textarea.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none';
  // 备用复制沿用 API 调用记录页的处理方式，选区需留在 Radix 弹窗内部。
  (previousFocus?.closest?.('[role="dialog"]') || document.body).appendChild(textarea);
  try {
    textarea.select();
    if (!document.execCommand('copy')) throw new Error('复制失败');
  } finally { textarea.remove(); previousFocus?.focus?.(); }
}

function resultStatus(result) {
  if (!result) return null;
  const details = [
    result.httpStatus ? `HTTP ${result.httpStatus}` : '',
    Number.isFinite(result.latencyMs) ? `耗时 ${result.latencyMs} ms` : '',
  ].filter(Boolean);
  return { type: result.type, message: `${result.message}${details.length ? `（${details.join(' · ')}）` : ''}` };
}

export function ProviderDiagnostics({ provider }) {
  const [state, setState] = useState(null);
  const [copyStatus, setCopyStatus] = useState(null);
  const requestRef = useRef(null);
  const copyRef = useRef(null);
  // 结果只属于发起请求时的连接配置；编辑模型用途不会丢失已经获取的目录。
  const identity = JSON.stringify([provider.id, provider.baseUrl, provider.protocol, provider.apiKey]);
  const current = state?.identity === identity ? state : {};
  const busy = Boolean(current.busy);
  const models = current.models?.data?.models || [];

  useEffect(() => {
    setState(null);
    setCopyStatus(null);
    return () => {
      requestRef.current?.controller.abort();
      requestRef.current = null;
      copyRef.current = null;
    };
  }, [identity]);

  const run = async (action) => {
    if (requestRef.current?.identity === identity) return;
    requestRef.current?.controller.abort();
    const request = { controller: new AbortController(), identity };
    requestRef.current = request;
    copyRef.current = null;
    setCopyStatus(null);
    setState(previous => ({
      ...(previous?.identity === identity ? previous : {}), identity, busy: action,
      [action]: { type: 'loading', message: action === 'probe' ? '正在检测供应商连通性...' : '正在获取供应商模型列表...' },
    }));
    try {
      const draft = { id: provider.id, baseUrl: provider.baseUrl, protocol: provider.protocol, apiKey: provider.apiKey };
      const json = action === 'probe'
        ? await api.probeAiProvider(draft, request.controller.signal)
        : await api.getAiProviderModels(draft, request.controller.signal);
      if (!json.success || !json.data || (action === 'models' && !Array.isArray(json.data.models))) {
        throw new Error(json.message || '检测返回格式异常，请稍后重试。');
      }
      if (requestRef.current !== request) return;
      const data = json.data;
      setState(previous => ({ ...previous, [action]: {
        ...data, data,
        type: action === 'models' && (!data.models.length || data.truncated) ? 'warning' : 'success',
      } }));
    } catch (error) {
      if (requestRef.current !== request || request.controller.signal.aborted) return;
      const timedOut = error.cause?.name === 'TimeoutError';
      setState(previous => ({ ...previous, [action]: {
        type: 'error', message: timedOut ? '检测请求超时，请检查供应商或本地服务后重试。' : error.message,
        httpStatus: error.data?.httpStatus, latencyMs: error.data?.latencyMs,
      } }));
    } finally {
      if (requestRef.current === request) {
        requestRef.current = null;
        setState(previous => previous?.identity === identity ? { ...previous, busy: '' } : previous);
      }
    }
  };

  const copyModelId = async (modelId) => {
    if (copyRef.current) return;
    const request = {};
    copyRef.current = request;
    setCopyStatus({ type: 'loading', message: '正在复制模型ID...' });
    try {
      await copyModelIdToClipboard(modelId);
      if (copyRef.current === request) setCopyStatus({ type: 'success', message: `已复制模型ID：${modelId}` });
    } catch {
      if (copyRef.current === request) setCopyStatus({ type: 'error', message: '复制失败，请选中模型 ID 手动复制，或检查浏览器的剪贴板权限。' });
    } finally {
      if (copyRef.current === request) copyRef.current = null;
    }
  };

  return (
    <section className="min-w-0 rounded-lg border border-[#e7e9ee] bg-[#fafbfc] p-3" aria-label="供应商检测">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={busy} onClick={() => run('probe')}>
          {current.busy === 'probe' ? <Loader2 className="animate-spin" /> : <Activity />}
          {current.busy === 'probe' ? '正在检测连通性...' : '测试连通性'}
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => run('models')}>
          {current.busy === 'models' ? <Loader2 className="animate-spin" /> : <List />}
          {current.busy === 'models' ? '正在获取模型列表...' : '获取模型列表'}
        </Button>
      </div>
      <p className="my-2 text-xs leading-5 text-[#69717e]">
        使用当前填写的地址和密钥，无需先保存。探针通过模型目录接口检查连通性，不生成内容；未开放目录的供应商可继续手动填写模型 ID。
      </p>
      <Status status={resultStatus(current.probe)} />
      <Status status={resultStatus(current.models)} />
      {models.length > 0 ? (
        <div className="grid min-w-0 gap-2">
          <ul className="m-0 max-h-52 list-none divide-y divide-[#edf0f4] overflow-y-auto rounded-md border border-[#e7e9ee] bg-white p-0" aria-label="供应商模型列表">
            {models.map(model => (
              <li key={model.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0 break-all text-xs">
                  <strong className="block font-mono text-[#30343b]">{model.id}</strong>
                  {model.name !== model.id ? <span className="mt-0.5 block text-[#69717e]">{model.name}</span> : null}
                </div>
                <Button variant="outline" size="sm" disabled={busy || copyStatus?.type === 'loading'}
                  aria-label={`复制模型ID ${model.id}`} onClick={() => copyModelId(model.id)}>复制模型ID</Button>
              </li>
            ))}
          </ul>
          <div className="min-w-0 break-all"><Status status={copyStatus} /></div>
        </div>
      ) : null}
    </section>
  );
}
