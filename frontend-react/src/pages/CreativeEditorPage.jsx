import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { CreativeVideoEditor } from '../components/creative-video-editor/CreativeVideoEditor.jsx';

function getWorkflowPayload(result) {
  return result?.workflow || result?.creative_workflow || result?.data?.workflow || result?.data || result || null;
}

function isNotFoundError(error) {
  return error?.status === 404 || error?.data?.code === 'NOT_FOUND' || error?.data?.error_code === 'NOT_FOUND';
}

function getErrorMessage(error) {
  if (isNotFoundError(error)) return '未找到创作任务。';
  return '加载编辑任务失败，请稍后重试。';
}

function getEditorWorkflowTitle(workflow, workflowId) {
  const rawText = workflow?.creative_context?.input?.raw_text;
  if (typeof rawText === 'string' && rawText.trim()) {
    const title = rawText.trim().replace(/\s+/g, ' ');
    return title.length > 32 ? `${title.slice(0, 32)}...` : title;
  }
  return workflow?.title || workflowId || '视频编辑器';
}

export function CreativeEditorPage() {
  const { workflowId } = useParams();
  const navigate = useNavigate();
  const [workflow, setWorkflow] = useState(null);
  const [loading, setLoading] = useState(Boolean(workflowId));
  const [errorMessage, setErrorMessage] = useState(workflowId ? '' : '缺少创作任务 ID。');
  const requestSeqRef = useRef(0);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadWorkflow = useCallback(async () => {
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    const canApplyRequest = () => mountedRef.current && requestSeqRef.current === requestSeq;

    if (!workflowId) {
      if (!mountedRef.current) return;
      setWorkflow(null);
      setLoading(false);
      setErrorMessage('缺少创作任务 ID。');
      return;
    }

    if (!canApplyRequest()) return;
    setLoading(true);
    setErrorMessage('');

    try {
      const result = await api.getCreativeWorkflow(workflowId);
      const payload = getWorkflowPayload(result);
      if (!canApplyRequest()) return;
      if (!payload) {
        setWorkflow(null);
        setErrorMessage('未找到创作任务。');
        return;
      }
      setWorkflow(payload);
    } catch (error) {
      if (!canApplyRequest()) return;
      setWorkflow(null);
      setErrorMessage(getErrorMessage(error));
    } finally {
      if (canApplyRequest()) {
        setLoading(false);
      }
    }
  }, [workflowId]);

  useEffect(() => {
    loadWorkflow();
  }, [loadWorkflow]);

  const backToCreative = () => {
    if (!workflowId) {
      navigate('/creative');
      return;
    }
    navigate(`/creative/${encodeURIComponent(workflowId)}`);
  };

  const title = getEditorWorkflowTitle(workflow, workflowId);

  return (
    <main className="min-h-[calc(100vh-64px)] bg-[#f6f7f9] px-6 py-4 max-[720px]:px-4">
      <header className="mb-3 flex items-center justify-between gap-4 max-[720px]:flex-col max-[720px]:items-start">
        <div>
          <span className="text-[13px] text-[#69717e]">视频编辑器</span>
          <h1 className="m-0 mt-0.5 text-lg font-bold text-[#20242a]">{title}</h1>
        </div>
        <button
          type="button"
          className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-[#d9dde5] bg-white px-4 text-sm font-semibold text-[#30343b] transition hover:border-[#bfdbfe] hover:bg-[#eef4ff] hover:text-[#2563eb] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25f4ee]"
          onClick={backToCreative}
        >
          <ArrowLeft size={16} />
          返回任务
        </button>
      </header>

      {loading && (
        <div className="mb-4 inline-flex items-center gap-2 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-[13px] font-semibold text-blue-700" role="status" aria-live="polite">
          <Loader2 size={16} className="spinIcon" />
          正在加载编辑任务...
        </div>
      )}

      {!loading && errorMessage && (
        <div className="mb-4 rounded-lg border border-red-100 bg-red-50 px-4 py-3 text-[13px] font-semibold text-red-700" role="alert">
          {errorMessage}
        </div>
      )}

      {!loading && !errorMessage && workflow && (
        <CreativeVideoEditor workflowId={workflowId} api={api} onRendered={loadWorkflow} />
      )}
    </main>
  );
}
