import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { api } from '../api/client.js';
import { Status } from '../components/Status.jsx';
import { Button } from '../components/ui/button.jsx';
import { Input } from '../components/ui/input.jsx';
import {
  getAgentConfigSourceLabel,
  getAgentResultSections,
  getAgentStepLabel,
  getDebugSections,
  getRunDisplayTime,
  getStoryboardDebugSections,
  getStoryboardSceneIssues,
  getWorkflowActionLabel,
  getWorkflowStageLabel,
  isLegacyAgentRun,
  sanitizeStoryboardSceneText,
} from '../utils/agentRuns.js';
import { DEFAULT_PROMPT_OPTIONS, DEFAULT_RENDER_OPTIONS, DEFAULT_STORYBOARD_OPTIONS } from '../utils/aiWorkspaceDefaults.js';
import { getAwemeIdFromSearch } from '../utils/workspaceParams.js';

const AGENT_TEMPLATES = [
  {
    id: 'viral_rewrite',
    label: '爆款拆解 + 改写脚本',
    description: '读取视频素材、转写文本和评论洞察，生成爆点拆解、受众画像、选题方向、改写脚本和标题建议。',
    actionLabel: '执行爆款拆解',
  },
  {
    id: 'comment_insights',
    label: '评论洞察',
    description: '读取本地评论缓存，提炼用户痛点、高频问题、情绪倾向、内容机会和回复建议。',
    actionLabel: '执行评论洞察',
  },
];

const TTS_VOICES = [
  { value: 'mimo_default', label: '默认音色' },
  { value: '冰糖', label: '冰糖' },
  { value: '茉莉', label: '茉莉' },
  { value: '苏打', label: '苏打' },
  { value: '白桦', label: '白桦' },
  { value: 'Mia', label: 'Mia' },
  { value: 'Chloe', label: 'Chloe' },
  { value: 'Milo', label: 'Milo' },
  { value: 'Dean', label: 'Dean' },
];

const DEFAULT_TTS_STYLE = '请使用自然、清晰、适合短视频口播的语气。';

function getTemplateMeta(templateId, templates = AGENT_TEMPLATES) {
  const template = templates.find(item => item.id === templateId);
  const fallback = AGENT_TEMPLATES.find(item => item.id === templateId) || AGENT_TEMPLATES[0];
  return {
    ...fallback,
    ...(template || {}),
    actionLabel: template?.actionLabel || fallback?.actionLabel || '执行 Agent',
  };
}

function formatCaptionTime(value) {
  const total = Number(value || 0);
  const minutes = Math.floor(total / 60);
  const seconds = Math.floor(total % 60);
  const millis = Math.round((total - Math.floor(total)) * 100);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(2, '0')}`;
}

function ResultSection({ section, ttsControls = null }) {
  const items = Array.isArray(section.items) ? section.items.filter(Boolean) : [];
  const text = section.text || '';

  return (
    <section className="agentResultSection">
      <div className="agentResultSectionHeader">
        <h4>{section.title}</h4>
        {ttsControls}
      </div>
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => <li key={`${section.key}-${index}`}>{item}</li>)}
        </ul>
      ) : (
        <p>{text || '暂无内容'}</p>
      )}
    </section>
  );
}

function StepStatus({ label, done, detail }) {
  return (
    <li>
      <span>{label}</span>
      <strong className={`stepBadge ${done ? 'done' : 'pending'}`}>{done ? '已完成' : '待准备'}</strong>
      {detail ? <small>{detail}</small> : null}
    </li>
  );
}

function JsonValue({ value }) {
  if (Array.isArray(value)) {
    return (
      <div className="jsonBlock">
        <span className="jsonPunctuation">[</span>
        <div className="jsonChildren">
          {value.map((item, index) => (
            <div className="jsonLine" key={index}>
              <span className="jsonIndex">{index}</span>
              <JsonValue value={item} />
            </div>
          ))}
        </div>
        <span className="jsonPunctuation">]</span>
      </div>
    );
  }
  if (value && typeof value === 'object') {
    return (
      <div className="jsonBlock">
        <span className="jsonPunctuation">{'{'}</span>
        <div className="jsonChildren">
          {Object.entries(value).map(([key, item]) => (
            <div className="jsonLine" key={key}>
              <span className="jsonKey">"{key}"</span>
              <span className="jsonPunctuation">:</span>
              <JsonValue value={item} />
            </div>
          ))}
        </div>
        <span className="jsonPunctuation">{'}'}</span>
      </div>
    );
  }
  if (typeof value === 'string') return <span className="jsonString">{JSON.stringify(value)}</span>;
  if (typeof value === 'number') return <span className="jsonNumber">{value}</span>;
  if (typeof value === 'boolean') return <span className="jsonBoolean">{String(value)}</span>;
  return <span className="jsonNull">null</span>;
}

function MessagesPreviewModal({ preview, onClose }) {
  if (!preview) return null;
  return (
    <div className="modalOverlay">
      <div className="modal wide messagesPreviewModal">
        <div className="mediaHeader">
          <h3>{preview.title || 'messages 预览'}</h3>
          <button className="btn secondary compact" onClick={onClose}>关闭</button>
        </div>
        <div className="jsonViewer" aria-label="messages JSON 预览">
          <JsonValue value={preview.messages || []} />
        </div>
      </div>
    </div>
  );
}

const WORKFLOW_ERROR_RUN_FIELDS = [
  'storyboard',
  'storyboard_raw',
  'storyboard_model',
  'storyboard_config_snapshot',
  'storyboard_messages',
  'storyboard_raw_output',
  'storyboard_parse',
  'storyboard_schema_validation',
  'workflow',
  'video',
];

function pickWorkflowErrorRunFields(data = {}) {
  return WORKFLOW_ERROR_RUN_FIELDS.reduce((picked, key) => {
    if (Object.prototype.hasOwnProperty.call(data, key)) picked[key] = data[key];
    return picked;
  }, {});
}

export function AiWorkspace({ routeSearch = '' } = {}) {
  const location = useLocation();
  const activeSearch = routeSearch || location.search;
  const initialAwemeId = useMemo(() => getAwemeIdFromSearch(activeSearch), [activeSearch]);
  const [awemeId, setAwemeId] = useState(initialAwemeId);
  const [mediaStatus, setMediaStatus] = useState(null);
  const [runs, setRuns] = useState([]);
  const [activeRun, setActiveRun] = useState(null);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [workflowRunning, setWorkflowRunning] = useState(false);
  const [storyboardConfig, setStoryboardConfig] = useState(null);
  const [storyboardConfigDraft, setStoryboardConfigDraft] = useState(null);
  const [storyboardConfigOpen, setStoryboardConfigOpen] = useState(false);
  const [storyboardDebugOpen, setStoryboardDebugOpen] = useState(false);
  const [expandedStoryboardScenes, setExpandedStoryboardScenes] = useState({});
  const [storyboardConfigSaving, setStoryboardConfigSaving] = useState(false);
  const [storyboardDraft, setStoryboardDraft] = useState(null);
  const [storyboardSaving, setStoryboardSaving] = useState(false);
  const [videoGenerating, setVideoGenerating] = useState(false);
  const [videoRendering, setVideoRendering] = useState(false);
  const [ttsVoice, setTtsVoice] = useState('mimo_default');
  const [ttsStylePrompt, setTtsStylePrompt] = useState(DEFAULT_TTS_STYLE);
  const [agentTemplates, setAgentTemplates] = useState(AGENT_TEMPLATES);
  const [agentConfig, setAgentConfig] = useState(null);
  const [agentConfigDraft, setAgentConfigDraft] = useState(null);
  const [agentResultSchemaText, setAgentResultSchemaText] = useState('{}');
  const [messagesPreview, setMessagesPreview] = useState(null);
  const [agentConfigOpen, setAgentConfigOpen] = useState(false);
  const [agentConfigSaving, setAgentConfigSaving] = useState(false);
  const [agentConfigPreviewing, setAgentConfigPreviewing] = useState(false);
  const [storyboardConfigPreviewing, setStoryboardConfigPreviewing] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState('viral_rewrite');
  const [renderOptions, setRenderOptions] = useState(DEFAULT_RENDER_OPTIONS);
  const [resultTab, setResultTab] = useState('workflow');

  const sortedRuns = useMemo(() => {
    return [...runs].sort((a, b) => {
      const left = new Date(a.created_at || a.updated_at || 0).getTime();
      const right = new Date(b.created_at || b.updated_at || 0).getTime();
      return right - left;
    });
  }, [runs]);

  const resultSections = useMemo(() => {
    return getAgentResultSections(activeRun?.result || {}, activeRun?.template || selectedTemplate, activeRun || {});
  }, [activeRun, selectedTemplate]);

  const agentSteps = useMemo(() => {
    return activeRun?.steps && typeof activeRun.steps === 'object'
      ? Object.entries(activeRun.steps)
      : [];
  }, [activeRun]);

  const transcriptReady = mediaStatus?.steps?.transcript?.status === 'done' || mediaStatus?.transcript?.status === 'done';
  const videoReady = mediaStatus?.steps?.video?.status === 'done';
  const audioReady = mediaStatus?.steps?.audio?.status === 'done';
  const mediaReady = videoReady && audioReady;
  const selectedAwemeId = mediaStatus?.aweme_id || awemeId.trim();
  const hasRewriteScript = !!(activeRun?.result?.rewrite_script && activeRun.result.rewrite_script.trim());
  const hasTtsCaptions = Array.isArray(activeRun?.tts?.captions) && activeRun.tts.captions.length > 0;
  const hasStoryboardScenes = Array.isArray(activeRun?.storyboard?.scenes) && activeRun.storyboard.scenes.length > 0;
  const persistedVideoRendering = activeRun?.video?.status === 'rendering';
  const videoBusy = videoGenerating || videoRendering || persistedVideoRendering;
  const workflow = activeRun?.workflow || {};
  const nextAction = workflow.next_action || (activeRun ? 'generate_storyboard_plan' : '');
  const legacyRun = isLegacyAgentRun(activeRun);
  const workflowBusy = workflowRunning || videoBusy;
  const workflowStartDisabled = loading || workflowBusy;
  const hasFailedQualityReport = activeRun?.video?.video_quality_report?.pass === false;
  const storyboardSceneIssues = useMemo(() => getStoryboardSceneIssues(storyboardDraft || {}), [storyboardDraft]);
  const storyboardIssueCount = Object.keys(storyboardSceneIssues).length;

  useEffect(() => {
    if (!activeRun) return;
    if (activeRun.video?.output_url || activeRun.video?.project_dir || hasStoryboardScenes) {
      setResultTab('video');
      return;
    }
    if (activeRun.tts?.url || hasRewriteScript) {
      setResultTab('tts');
      return;
    }
    setResultTab('result');
  }, [activeRun?.run_id, activeRun?.tts?.url, activeRun?.video?.project_dir, activeRun?.video?.output_url, hasRewriteScript, hasStoryboardScenes]);

  useEffect(() => {
    if (activeRun?.storyboard) {
      setStoryboardDraft(JSON.parse(JSON.stringify(activeRun.storyboard)));
    } else {
      setStoryboardDraft(null);
    }
  }, [activeRun?.run_id, activeRun?.storyboard?.updated_at]);

  useEffect(() => {
    const issueSceneIndexes = Object.keys(storyboardSceneIssues);
    if (!issueSceneIndexes.length) return;
    setExpandedStoryboardScenes(prev => {
      const next = { ...prev };
      issueSceneIndexes.forEach(index => {
        next[index] = true;
      });
      return next;
    });
  }, [storyboardSceneIssues]);

  useEffect(() => {
    const nextAwemeId = getAwemeIdFromSearch(activeSearch);
    if (!nextAwemeId) return;
    setAwemeId(nextAwemeId);
    loadWorkspace(nextAwemeId).catch(() => {});
  }, [activeSearch]);

  async function loadWorkspace(explicitAwemeId = '') {
    const value = (explicitAwemeId || awemeId).trim();
    if (!value) {
      setStatus({ type: 'error', message: '请输入抖音视频 aweme_id' });
      return;
    }

    setLoading(true);
    setStatus({ type: 'loading', message: '正在读取素材状态和历史 Agent 运行记录...' });
    try {
      const [mediaJson, runsJson] = await Promise.all([
        api.getDouyinMediaStatus(value),
        api.listDouyinAgentRuns(value),
        loadAgentTemplates(selectedTemplate),
      ]);
      const runList = runsJson.data || [];
      setMediaStatus(mediaJson);
      setRuns(runList);
      setActiveRun(runList[0] || null);
      setStatus({ type: 'success', message: `已加载素材 ${value}` });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setLoading(false);
    }
  }

  async function loadAgentTemplates(nextTemplate = selectedTemplate) {
    const listJson = await api.listAgentTemplates();
    const nextTemplates = listJson.data || [];
    setAgentTemplates(nextTemplates.length ? nextTemplates : AGENT_TEMPLATES);
    const detailJson = await api.getAgentTemplate(nextTemplate);
    setAgentConfig(detailJson.data);
    setAgentConfigDraft(detailJson.data);
    setAgentResultSchemaText(JSON.stringify(detailJson.data?.resultSchema || {}, null, 2));
    setMessagesPreview(null);
    const storyboardTemplateJson = await api.getStoryboardTemplate();
    setStoryboardConfig(storyboardTemplateJson.data);
    setStoryboardConfigDraft(storyboardTemplateJson.data);
  }

  function updateAgentConfigDraft(key, value) {
    setAgentConfigDraft(prev => ({ ...(prev || {}), [key]: value }));
  }

  function updateAgentModelOption(key, value) {
    setAgentConfigDraft(prev => ({
      ...(prev || {}),
      modelOptions: {
        ...((prev && prev.modelOptions) || {}),
        [key]: key === 'stream' ? Boolean(value) : value,
      },
    }));
  }

  async function selectTemplate(template) {
    setSelectedTemplate(template.id);
    setStatus({ type: 'loading', message: '正在加载 Agent 模板配置...' });
    try {
      const detailJson = await api.getAgentTemplate(template.id);
      setAgentConfig(detailJson.data);
      setAgentConfigDraft(detailJson.data);
      setAgentResultSchemaText(JSON.stringify(detailJson.data?.resultSchema || {}, null, 2));
      setMessagesPreview(null);
      setStatus({ type: 'success', message: 'Agent 模板配置已加载。' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    }
  }

  async function runAgentTemplate(template) {
    const value = selectedAwemeId.trim();
    const actionLabel = getTemplateMeta(template.id, agentTemplates).actionLabel || '执行 Agent';
    if (!value) {
      setStatus({ type: 'error', message: '请输入抖音视频 aweme_id' });
      return;
    }
    setSelectedTemplate(template.id);
    setWorkflowRunning(true);
    setStatus({ type: 'loading', message: `正在${actionLabel}...` });
    try {
      const agentOverride = agentConfigDraft?.id === template.id ? {
        systemPrompt: agentConfigDraft.systemPrompt,
        userPromptTemplate: agentConfigDraft.userPromptTemplate,
        resultSchema: JSON.parse(agentResultSchemaText || '{}'),
        modelOptions: agentConfigDraft.modelOptions || {},
      } : null;
      const json = await api.createDouyinAgentRun(value, template.id, DEFAULT_PROMPT_OPTIONS, agentOverride);
      const runsJson = await api.listDouyinAgentRuns(value);
      const runList = runsJson.data || [];
      setRuns(runList);
      const currentRun = runList.find(run => run.run_id === (json?.run?.run_id || json?.run_id))
        || json?.run
        || runList[0]
        || null;
      setActiveRun(currentRun);
      setResultTab('result');
      setStatus({ type: json?.success === false ? 'error' : 'success', message: json?.message || `${actionLabel}已完成。` });
    } catch (error) {
      setStatus({ type: 'error', message: error instanceof SyntaxError ? '输出字段说明必须是有效 JSON。' : error.message });
    } finally {
      setWorkflowRunning(false);
    }
  }

  async function saveAgentConfig() {
    if (!agentConfigDraft?.id) return;
    setAgentConfigSaving(true);
    setStatus({ type: 'loading', message: '正在保存 Agent 模板配置...' });
    try {
      const resultSchema = JSON.parse(agentResultSchemaText || '{}');
      const json = await api.saveAgentTemplate(agentConfigDraft.id, { ...agentConfigDraft, resultSchema });
      setAgentConfig(json.data);
      setAgentConfigDraft(json.data);
      await loadAgentTemplates(agentConfigDraft.id);
      setStatus({ type: 'success', message: json.message || 'Agent 模板配置已保存。' });
    } catch (error) {
      setStatus({ type: 'error', message: error instanceof SyntaxError ? '输出字段说明必须是有效 JSON。' : error.message });
    } finally {
      setAgentConfigSaving(false);
    }
  }

  async function restoreAgentConfig() {
    if (!selectedTemplate) return;
    setAgentConfigSaving(true);
    setStatus({ type: 'loading', message: '正在恢复默认 Agent 模板配置...' });
    try {
      const json = await api.restoreAgentTemplate(selectedTemplate);
      await loadAgentTemplates(selectedTemplate);
      setStatus({ type: 'success', message: json.message || '已恢复默认 Agent 模板配置。' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setAgentConfigSaving(false);
    }
  }

  async function previewAgentMessages() {
    setAgentConfigPreviewing(true);
    setStatus({ type: 'loading', message: '正在预览 messages...' });
    try {
      const resultSchema = JSON.parse(agentResultSchemaText || '{}');
      const json = await api.previewAgentMessages({
        ...agentConfigDraft,
        resultSchema,
      }, {
        videoTitle: mediaStatus?.video?.title || activeRun?.input_summary?.title || '示例标题',
        authorName: mediaStatus?.video?.author?.nickname || activeRun?.input_summary?.author || '示例作者',
        awemeUrl: selectedAwemeId,
        transcriptText: '示例转写文本',
        transcriptNote: '预览时使用示例转写文本。',
        commentsText: '示例评论',
        commentsNote: '预览时使用示例评论。',
        promptOptionsText: '预览时使用当前模板和示例素材变量。',
      });
      setMessagesPreview({
        title: `${getTemplateMeta(selectedTemplate, agentTemplates).label} messages 预览`,
        messages: json.messages || [],
      });
      setStatus({ type: 'success', message: json.message || 'messages 已生成。' });
    } catch (error) {
      setStatus({ type: 'error', message: error instanceof SyntaxError ? '输出字段说明必须是有效 JSON。' : error.message });
    } finally {
      setAgentConfigPreviewing(false);
    }
  }

  function updateStoryboardConfigDraft(key, value) {
    setStoryboardConfigDraft(prev => ({ ...(prev || {}), [key]: value }));
  }

  function updateStoryboardModelOption(key, value) {
    setStoryboardConfigDraft(prev => ({
      ...(prev || {}),
      modelOptions: {
        ...((prev && prev.modelOptions) || {}),
        [key]: key === 'stream' ? Boolean(value) : value,
      },
    }));
  }

  async function previewStoryboardMessages() {
    setStoryboardConfigPreviewing(true);
    setStatus({ type: 'loading', message: '正在预览分镜 messages...' });
    try {
      const captions = Array.isArray(activeRun?.tts?.captions) && activeRun.tts.captions.length > 0
        ? activeRun.tts.captions.map(caption => ({
          index: caption.index,
          text: typeof caption.text === 'string' ? caption.text : '',
        }))
        : [
          { index: 0, text: '示例字幕一' },
          { index: 1, text: '示例字幕二' },
        ];
      const json = await api.previewStoryboardMessages(storyboardConfigDraft, {
        rewriteScript: activeRun?.result?.rewrite_script || '预览时使用示例改写脚本。',
        captionIndexesJson: JSON.stringify(captions, null, 2),
        frameProfileBrief: storyboardConfigDraft?.useFrameProfile === false ? '' : '预览时使用示例 Frame Profile 文档摘要。',
        storyboardOptionsText: '预览时使用当前分镜模板和示例素材变量。',
      });
      setMessagesPreview({
        title: '分镜 Agent messages 预览',
        messages: json.messages || [],
      });
      setStatus({ type: 'success', message: json.message || '分镜 messages 已生成。' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setStoryboardConfigPreviewing(false);
    }
  }

  async function saveStoryboardConfig() {
    setStoryboardConfigSaving(true);
    setStatus({ type: 'loading', message: '正在保存分镜 Agent 配置...' });
    try {
      const json = await api.saveStoryboardTemplate(storyboardConfigDraft);
      setStoryboardConfig(json.data);
      setStoryboardConfigDraft(json.data);
      setStatus({ type: 'success', message: json.message || '分镜 Agent 配置已保存。' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setStoryboardConfigSaving(false);
    }
  }

  async function restoreStoryboardConfig() {
    setStoryboardConfigSaving(true);
    setStatus({ type: 'loading', message: '正在恢复默认分镜 Agent 配置...' });
    try {
      const json = await api.restoreStoryboardTemplate();
      const detail = await api.getStoryboardTemplate();
      setStoryboardConfig(detail.data);
      setStoryboardConfigDraft(detail.data);
      setStatus({ type: 'success', message: json.message || '已恢复默认分镜 Agent 配置。' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setStoryboardConfigSaving(false);
    }
  }

  function updateStoryboardScene(index, key, value) {
    setStoryboardDraft(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: prev.scenes.map(scene => (
          scene.index === index ? { ...scene, [key]: value } : scene
        )),
      };
    });
  }

  function toggleStoryboardScene(index) {
    setExpandedStoryboardScenes(prev => ({ ...prev, [index]: !prev[index] }));
  }

  function cleanStoryboardScene(index) {
    setStoryboardDraft(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        scenes: prev.scenes.map(scene => (
          scene.index === index ? { ...scene, ...sanitizeStoryboardSceneText(scene) } : scene
        )),
      };
    });
    setExpandedStoryboardScenes(prev => ({ ...prev, [index]: true }));
    setStatus({ type: 'info', message: `已清理分镜 ${index} 的乱码字段，请保存分镜修改后再生成视频工程。` });
  }

  function updateStoryboardSceneIndexes(index, value) {
    const indexes = String(value || '')
      .split(/[,，]/)
      .map(item => Number(item.trim()))
      .filter(Number.isFinite);
    updateStoryboardScene(index, 'caption_indexes', indexes);
  }

  function updateStoryboardSceneEmphasis(index, value) {
    const words = String(value || '')
      .split(/[,，]/)
      .map(item => item.trim())
      .filter(Boolean);
    updateStoryboardScene(index, 'emphasis_words', words);
  }

  async function saveStoryboardDraft() {
    const value = selectedAwemeId.trim();
    if (!value || !activeRun?.run_id || !storyboardDraft) {
      setStatus({ type: 'error', message: '请先选择一条包含分镜的运行记录。' });
      return;
    }
    setStoryboardSaving(true);
    setStatus({ type: 'loading', message: '正在校验并保存 AI 分镜...' });
    try {
      const json = await api.saveDouyinRunStoryboard(value, activeRun.run_id, storyboardDraft);
      setActiveRun(prev => prev ? {
        ...prev,
        storyboard: json.storyboard,
        storyboard_schema_validation: json.storyboard_schema_validation,
        workflow: json.workflow || prev.workflow,
        video: null,
        updated_at: new Date().toISOString(),
      } : prev);
      setRuns(prev => prev.map(run => (
        run.run_id === activeRun.run_id ? {
          ...run,
          storyboard: json.storyboard,
          storyboard_schema_validation: json.storyboard_schema_validation,
          workflow: json.workflow || run.workflow,
          video: null,
          updated_at: new Date().toISOString(),
        } : run
      )));
      setStatus({ type: 'success', message: json.message || '分镜已保存。' });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setStoryboardSaving(false);
    }
  }

  function updateRenderOption(key, value) {
    setRenderOptions(prev => ({ ...prev, [key]: value }));
  }

  function selectRun(run) {
    setActiveRun(run);
    if (run.template) setSelectedTemplate(run.template);
    setStatus({ type: 'success', message: `已切换到运行记录 ${run.run_id}` });
  }

  async function runNextWorkflowAction() {
    const value = selectedAwemeId.trim();
    if (!value) {
      setStatus({ type: 'error', message: '请输入抖音视频 aweme_id' });
      return;
    }
    const workflowAction = nextAction || 'generate_storyboard_plan';
    if (workflowAction !== 'generate_storyboard_plan' && !activeRun?.run_id) {
      setStatus({ type: 'error', message: '请先选择一条运行记录。' });
      return;
    }

    const actionLabel = getWorkflowActionLabel(workflowAction);
    setWorkflowRunning(true);
    setStatus({ type: 'loading', message: `正在${actionLabel}...` });
    try {
      if (workflowAction === 'generate_video_project') {
        await createVideoProject();
        return;
      }
      if (workflowAction === 'render_video') {
        await renderVideo();
        return;
      }

      let json = null;
      if (workflowAction === 'generate_storyboard_plan') {
        json = await api.createDouyinStoryboardPlanRun(value, DEFAULT_PROMPT_OPTIONS);
      } else if (workflowAction === 'synthesize_scene_tts' || workflowAction === 'retry_scene_tts') {
        json = await api.synthesizeDouyinRunSceneTts(value, activeRun.run_id, {
          voice: ttsVoice,
          stylePrompt: ttsStylePrompt,
        });
      } else if (workflowAction === 'compress_scene_narration') {
        json = await api.compressDouyinRunSceneNarration(value, activeRun.run_id);
      } else if (workflowAction === 'generate_visual_storyboard' || workflowAction === 'repair_visual_storyboard') {
        const storyboardOverride = storyboardConfigDraft ? {
          systemPrompt: storyboardConfigDraft.systemPrompt,
          userPromptTemplate: storyboardConfigDraft.userPromptTemplate,
          useFrameProfile: storyboardConfigDraft.useFrameProfile !== false,
          modelOptions: storyboardConfigDraft.modelOptions || {},
        } : null;
        json = await api.createDouyinRunVisualStoryboard(
          value,
          activeRun.run_id,
          DEFAULT_STORYBOARD_OPTIONS,
          storyboardOverride,
          renderOptions.frameStyle,
          activeRun?.video?.video_quality_report || null,
        );
      } else {
        setStatus({ type: 'info', message: `${getWorkflowActionLabel(workflowAction)} 暂时不需要在此处手动触发。` });
        return;
      }

      const runsJson = await api.listDouyinAgentRuns(value);
      const runList = runsJson.data || [];
      setRuns(runList);
      const currentRun = runList.find(run => run.run_id === (json?.run?.run_id || json?.run_id || activeRun?.run_id)) || runList[0] || json?.run || json || null;
      setActiveRun(currentRun);
      setStatus({ type: json?.success === false ? 'error' : 'success', message: json?.message || `${actionLabel}已完成。` });
    } catch (error) {
      const errorRunFields = pickWorkflowErrorRunFields(error.data || {});
      if (Object.keys(errorRunFields).length > 0) {
        setActiveRun(prev => prev ? {
          ...prev,
          ...errorRunFields,
          updated_at: new Date().toISOString(),
        } : prev);
        setRuns(prev => prev.map(run => (
          run.run_id === activeRun?.run_id ? {
            ...run,
            ...errorRunFields,
            updated_at: new Date().toISOString(),
          } : run
        )));
        if (errorRunFields.storyboard_raw_output || errorRunFields.storyboard_parse || errorRunFields.storyboard_schema_validation) {
          setResultTab('debug');
        }
      }
      setStatus({ type: 'error', message: error.message });
    } finally {
      setWorkflowRunning(false);
    }
  }

  async function createVideoProject() {
    const value = selectedAwemeId.trim();
    if (!value || !activeRun?.run_id) {
      setStatus({ type: 'error', message: '请先选择一条已生成 AI 分镜的运行记录。' });
      return;
    }
    if (!hasStoryboardScenes) {
      setStatus({ type: 'error', message: '请先生成 AI 分镜。' });
      return;
    }

    setVideoGenerating(true);
    setStatus({ type: 'loading', message: '正在生成 HyperFrames 视频工程...' });
    try {
      const json = await api.createDouyinRunHyperframesProject(value, activeRun.run_id, renderOptions);
      setActiveRun(prev => prev ? { ...prev, video: json.video, workflow: json.workflow || prev.workflow, updated_at: new Date().toISOString() } : prev);
      setRuns(prev => prev.map(run => (
        run.run_id === activeRun.run_id ? { ...run, video: json.video, workflow: json.workflow || run.workflow, updated_at: new Date().toISOString() } : run
      )));
      setStatus({
        type: json.success ? 'success' : 'error',
        message: json.message || (json.success ? '视频工程已生成。' : '视频工程生成失败。'),
      });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setVideoGenerating(false);
    }
  }

  async function renderVideo() {
    const value = selectedAwemeId.trim();
    if (!value || !activeRun?.run_id) {
      setStatus({ type: 'error', message: '请先选择一条已生成视频工程的运行记录。' });
      return;
    }
    if (!activeRun.video?.project_dir) {
      setStatus({ type: 'error', message: '请先生成视频工程。' });
      return;
    }

    setVideoRendering(true);
    setStatus({ type: 'loading', message: '正在调用 HyperFrames 渲染 MP4...' });
    try {
      const json = await api.renderDouyinRunHyperframesVideo(value, activeRun.run_id);
      setActiveRun(prev => prev ? { ...prev, video: json.video, workflow: json.workflow || prev.workflow, updated_at: new Date().toISOString() } : prev);
      setRuns(prev => prev.map(run => (
        run.run_id === activeRun.run_id ? { ...run, video: json.video, workflow: json.workflow || run.workflow, updated_at: new Date().toISOString() } : run
      )));
      setStatus({
        type: json.success ? 'success' : 'error',
        message: json.message || (json.success ? '视频渲染完成。' : '视频渲染失败。'),
      });
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setVideoRendering(false);
    }
  }

  return (
    <main className="container">
      <div className="workspaceIntro">
        <div>
          <h2>AI 任务流工作台</h2>
          <p>输入抖音视频 aweme_id，读取素材状态和历史运行记录，然后按顺序生成导演分镜、分段配音、视觉分镜、视频工程和 MP4。</p>
        </div>
        {selectedAwemeId ? <code>{selectedAwemeId}</code> : null}
      </div>

      <div className="toolbar">
        <Input
          value={awemeId}
          onChange={event => setAwemeId(event.target.value)}
          onKeyDown={event => event.key === 'Enter' && !loading && loadWorkspace()}
          placeholder="输入抖音视频 aweme_id"
          disabled={loading || workflowBusy}
        />
        <Button variant="secondary" disabled={workflowStartDisabled} onClick={loadWorkspace}>加载工作台</Button>
        <Button disabled={workflowStartDisabled} onClick={runNextWorkflowAction}>
          {workflowRunning ? '处理中...' : getWorkflowActionLabel(nextAction || 'generate_storyboard_plan')}
        </Button>
      </div>

      <Status status={status} />
      {loading ? <div className="pageLoading">正在加载素材状态和历史 Agent 运行记录...</div> : null}
      <MessagesPreviewModal preview={messagesPreview} onClose={() => setMessagesPreview(null)} />

      <section className="agentWorkbench">
        <div className="agentPanel">
          <h3>Agent 配置</h3>
          {agentTemplates.map(template => (
            <div className={`agentTemplate ${selectedTemplate === template.id ? 'active' : ''}`} key={template.id}>
              <strong>{template.label}</strong>
              <p>{template.description}</p>
              <span className="configSource">{getAgentConfigSourceLabel(template.source)}</span>
              <Button
                variant={selectedTemplate === template.id ? 'default' : 'secondary'}
                disabled={loading || workflowBusy}
                onClick={() => selectTemplate(template)}
              >
                {selectedTemplate === template.id ? '已选择' : '选择模板'}
              </Button>
              <Button
                variant="secondary"
                disabled={loading || workflowBusy}
                onClick={() => runAgentTemplate(template)}
              >
                {workflowRunning && selectedTemplate === template.id
                  ? '执行中...'
                  : activeRun?.template === template.id ? '重新执行当前模板' : getTemplateMeta(template.id, agentTemplates).actionLabel}
              </Button>
            </div>
          ))}
          <div className="agentOptionGroup">
            <div className="agentResultSectionHeader">
              <h4>高级编辑</h4>
              <Button size="sm" variant="secondary" onClick={() => setAgentConfigOpen(value => !value)}>
                {agentConfigOpen ? '收起' : '展开'}
              </Button>
            </div>
            {agentConfigOpen && agentConfigDraft ? (
              <div className="promptEditor">
                <label>
                  <span>system prompt</span>
                  <textarea
                    value={agentConfigDraft.systemPrompt || ''}
                    onChange={event => updateAgentConfigDraft('systemPrompt', event.target.value)}
                    disabled={loading || workflowBusy || agentConfigSaving}
                  />
                </label>
                <label>
                  <span>user prompt 模板</span>
                  <textarea
                    value={agentConfigDraft.userPromptTemplate || ''}
                    onChange={event => updateAgentConfigDraft('userPromptTemplate', event.target.value)}
                    disabled={loading || workflowBusy || agentConfigSaving}
                  />
                </label>
                <label>
                  <span>输出字段说明 JSON</span>
                  <textarea
                    value={agentResultSchemaText}
                    onChange={event => setAgentResultSchemaText(event.target.value)}
                    disabled={loading || workflowBusy || agentConfigSaving || agentConfigPreviewing}
                    placeholder='例如：{"summary":"string"}'
                  />
                </label>
                <label>
                  <span>temperature</span>
                  <Input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={agentConfigDraft.modelOptions?.temperature ?? 0.4}
                    onChange={event => updateAgentModelOption('temperature', Number(event.target.value))}
                    disabled={loading || workflowBusy || agentConfigSaving}
                  />
                </label>
                <label className="inlineCheck">
                  <input
                    type="checkbox"
                    checked={agentConfigDraft.modelOptions?.stream !== false}
                    onChange={event => updateAgentModelOption('stream', event.target.checked)}
                    disabled={loading || workflowBusy || agentConfigSaving}
                  />
                  流式调用
                </label>
                <label>
                  <span>maxRetries</span>
                  <Input
                    type="number"
                    min="0"
                    max="5"
                    step="1"
                    value={agentConfigDraft.modelOptions?.maxRetries ?? 1}
                    onChange={event => updateAgentModelOption('maxRetries', Number(event.target.value))}
                    disabled={loading || workflowBusy || agentConfigSaving}
                  />
                </label>
                <div className="videoProjectActions">
                  <Button size="sm" variant="secondary" disabled={loading || workflowBusy || agentConfigSaving || agentConfigPreviewing} onClick={restoreAgentConfig}>恢复默认</Button>
                  <Button size="sm" variant="secondary" disabled={loading || workflowBusy || agentConfigSaving || agentConfigPreviewing} onClick={previewAgentMessages}>
                    {agentConfigPreviewing ? '预览中...' : '预览 messages'}
                  </Button>
                  <Button size="sm" disabled={loading || workflowBusy || agentConfigSaving || agentConfigPreviewing} onClick={saveAgentConfig}>保存为当前模板配置</Button>
                </div>
              </div>
            ) : null}
          </div>
          <h3>素材状态</h3>
          <ul className="agentStatusList">
            <StepStatus label="视频和音频" done={mediaReady} detail="Agent 需要视频和音频素材都已准备完成" />
            <StepStatus label="音频转写" done={transcriptReady} detail="建议先完成转写，结果会更稳定" />
          </ul>
        </div>

        <div className="agentPanel">
          <h3>执行步骤</h3>
          <div className="agentSteps">
            {agentSteps.length > 0 ? agentSteps.map(([key, step]) => (
              <div className="agentStep" key={key}>
                <span>{step?.label || key}</span>
                <strong className={`stepBadge ${step?.status || 'pending'}`}>{getAgentStepLabel(step?.status)}</strong>
                {step?.message ? <small>{step.message}</small> : null}
              </div>
            )) : <p className="mutedText">暂无执行步骤</p>}
          </div>

          <h3>历史运行</h3>
          <div className="agentRunList">
            {sortedRuns.length > 0 ? sortedRuns.map(run => (
              <button
                type="button"
                key={run.run_id}
                className={`agentRunItem ${activeRun?.run_id === run.run_id ? 'active' : ''}`}
                onClick={() => selectRun(run)}
              >
                <strong>{run.template || 'viral_rewrite'}</strong>
                <span>{getRunDisplayTime(run.created_at || run.updated_at)}</span>
                {!run.parse?.success ? <span className="runIssueBadge">解析失败</span> : null}
                {run.schema_validation && !run.schema_validation.success ? <span className="runIssueBadge">校验失败</span> : null}
                {run.storyboard_parse && !run.storyboard_parse.success ? <span className="runIssueBadge">分镜解析失败</span> : null}
                {run.storyboard_schema_validation && !run.storyboard_schema_validation.success ? <span className="runIssueBadge">分镜校验失败</span> : null}
              </button>
            )) : <p className="mutedText">暂无历史运行</p>}
          </div>
        </div>

        <div className="agentPanel agentResultPanel">
          <div className="agentResultTitleRow">
            <h3>生成结果</h3>
            {activeRun ? <span>{activeRun.run_id}</span> : null}
          </div>
          {activeRun ? (
            <>
              <div className="agentRunMeta">
                <span>{activeRun.template || 'viral_rewrite'}</span>
                <span>{getAgentConfigSourceLabel(activeRun.agent_config_snapshot?.source)}</span>
                <strong className={`stepBadge ${activeRun.status || 'pending'}`}>{getAgentStepLabel(activeRun.status)}</strong>
                <span>{getRunDisplayTime(activeRun.created_at || activeRun.updated_at)}</span>
              </div>
              <div className="agentResultTabs" role="tablist" aria-label="生成结果视图">
                {[
                  ['workflow', '流程'],
                  ['result', '文案'],
                  ['tts', '配音'],
                  ['video', '成片'],
                  ['debug', '调试'],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    className={`agentResultTab ${resultTab === id ? 'active' : ''}`}
                    onClick={() => setResultTab(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {resultTab === 'workflow' ? (
                <section className="agentResultSection compactWorkflow">
                  <div className="agentResultSectionHeader">
                    <h4>AI 工作流</h4>
                    <strong className="stepBadge pending">{getWorkflowStageLabel(workflow.stage || 'empty')}</strong>
                  </div>
                  {legacyRun ? (
                    <>
                      <p className="mutedText">旧流程记录仅用于查看历史结果；可以点击“生成导演分镜”创建新的分镜优先流程记录。</p>
                      <Button disabled={workflowStartDisabled} onClick={runNextWorkflowAction}>
                        {workflowRunning ? '处理中...' : getWorkflowActionLabel('generate_storyboard_plan')}
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="mutedText">下一步：{getWorkflowActionLabel(nextAction || 'generate_storyboard_plan')}</p>
                      <p className="mutedText">流程：生成导演分镜 → 生成分段配音 → 生成视觉分镜 → 生成视频工程 → 渲染视频</p>
                      <Button disabled={workflowStartDisabled} onClick={runNextWorkflowAction}>
                        {workflowRunning ? '处理中...' : getWorkflowActionLabel(nextAction || 'generate_storyboard_plan')}
                      </Button>
                    </>
                  )}
                  <div className="agentSteps compact">
                    {agentSteps.length > 0 ? agentSteps.map(([key, step]) => (
                      <div className="agentStep" key={key}>
                        <span>{step?.label || key}</span>
                        <strong className={`stepBadge ${step?.status || 'pending'}`}>{getAgentStepLabel(step?.status)}</strong>
                        {step?.message ? <small>{step.message}</small> : null}
                      </div>
                    )) : <p className="mutedText">暂无执行步骤</p>}
                  </div>
                </section>
              ) : null}

              {resultTab === 'result' ? (
                <>
                  {resultSections.map(section => (
                    <ResultSection
                      key={section.key}
                      section={section}
                      ttsControls={section.key === 'rewrite_script' && hasRewriteScript ? (
                        <div className="ttsInlineControls">
                          <select
                            value={ttsVoice}
                            onChange={event => setTtsVoice(event.target.value)}
                            disabled={workflowBusy}
                            aria-label="TTS 音色"
                          >
                            {TTS_VOICES.map(voice => (
                              <option key={voice.value} value={voice.value}>{voice.label}</option>
                            ))}
                          </select>
                          <Input
                            value={ttsStylePrompt}
                            onChange={event => setTtsStylePrompt(event.target.value)}
                            disabled={workflowBusy}
                            placeholder="输入语气、情绪、节奏或音频标签"
                          />
                          <span className="mutedText">分段配音请使用工作流主按钮。</span>
                        </div>
                      ) : null}
                    />
                  ))}
                  {activeRun.raw_text ? (
                    <section className="agentResultSection">
                      <h4>原始返回</h4>
                      <pre>{activeRun.raw_text}</pre>
                    </section>
                  ) : null}
                </>
              ) : null}

              {resultTab === 'tts' ? (
                <section className="agentResultSection ttsPlayback">
                  <h4>TTS 音频</h4>
                  {hasRewriteScript ? (
                    <div className="ttsInlineControls standalone">
                      <select
                        value={ttsVoice}
                        onChange={event => setTtsVoice(event.target.value)}
                        disabled={workflowBusy}
                        aria-label="TTS 音色"
                      >
                        {TTS_VOICES.map(voice => (
                          <option key={voice.value} value={voice.value}>{voice.label}</option>
                        ))}
                      </select>
                      <Input
                        value={ttsStylePrompt}
                        onChange={event => setTtsStylePrompt(event.target.value)}
                        disabled={workflowBusy}
                        placeholder="输入语气、情绪、节奏或音频标签"
                      />
                      <span className="mutedText">分段配音请使用工作流主按钮。</span>
                    </div>
                  ) : <p className="mutedText">当前运行记录没有可用于 TTS 的改写脚本。</p>}
                  {activeRun.tts?.url ? (
                    <>
                      <audio controls src={activeRun.tts.url} />
                      <div className="agentRunMeta">
                        <span>{activeRun.tts.voice || '未记录音色'}</span>
                        <span>{activeRun.tts.model?.model_id || '未记录模型'}</span>
                        <span>{getRunDisplayTime(activeRun.tts.updated_at)}</span>
                      </div>
                      {hasTtsCaptions ? (
                        <div className="ttsCaptionList">
                          {activeRun.tts.captions.map(caption => (
                            <div className="ttsCaptionItem" key={caption.index}>
                              <code>{formatCaptionTime(caption.start)} - {formatCaptionTime(caption.end)}</code>
                              <span>{caption.text}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </section>
              ) : null}

              {resultTab === 'debug' ? (
                <>
                  {getDebugSections(activeRun).map(section => (
                    <section className="agentResultSection" key={section.key}>
                      <h4>{section.title}</h4>
                      <pre>{section.text || '暂无内容'}</pre>
                    </section>
                  ))}
                </>
              ) : null}

              {resultTab === 'video' ? (
                <section className="agentResultSection ttsPlayback">
                  <h4>AI 分镜与成片</h4>
                  <div className="videoProjectPanel">
                    <div className="videoProjectToolbar">
                      <div>
                        <strong>成片操作</strong>
                        <span>
                          {storyboardDraft?.scenes?.length ? `${storyboardDraft.scenes.length} 个分镜` : '暂无分镜'}
                          {storyboardIssueCount ? `，${storyboardIssueCount} 个分镜需处理` : ''}
                        </span>
                      </div>
                      <div className="videoProjectActions">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={storyboardSaving || videoBusy || !storyboardDraft?.scenes?.length}
                          onClick={saveStoryboardDraft}
                        >
                          {storyboardSaving ? '保存中...' : '保存分镜修改'}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={workflowStartDisabled}
                          onClick={runNextWorkflowAction}
                        >
                          {workflowRunning ? '处理中...' : getWorkflowActionLabel(nextAction || 'generate_storyboard_plan')}
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={workflowBusy || !hasStoryboardScenes}
                          onClick={createVideoProject}
                        >
                          {videoGenerating ? '生成中...' : '生成视频工程'}
                        </Button>
                        <Button
                          size="sm"
                          disabled={workflowBusy || !activeRun.video?.project_dir}
                          onClick={renderVideo}
                        >
                          {videoRendering || persistedVideoRendering ? '渲染中...' : '渲染 MP4'}
                        </Button>
                      </div>
                    </div>
                    {storyboardIssueCount ? (
                      <div className="storyboardIssueSummary">
                        分镜中仍有乱码字段，请展开标红分镜清理并点击“保存分镜修改”。
                      </div>
                    ) : null}
                    <div className="agentOptionGroup">
                      <div className="agentResultSectionHeader">
                        <h4>分镜 Agent 高级编辑</h4>
                        <Button size="sm" variant="secondary" onClick={() => setStoryboardConfigOpen(value => !value)}>
                          {storyboardConfigOpen ? '收起' : '展开'}
                        </Button>
                      </div>
                      {storyboardConfigOpen && storyboardConfigDraft ? (
                        <div className="promptEditor">
                          <label>
                            <span>system prompt</span>
                            <textarea
                              value={storyboardConfigDraft.systemPrompt || ''}
                              onChange={event => updateStoryboardConfigDraft('systemPrompt', event.target.value)}
                              disabled={storyboardConfigSaving || workflowBusy}
                            />
                          </label>
                          <label>
                            <span>user prompt 模板</span>
                            <textarea
                              value={storyboardConfigDraft.userPromptTemplate || ''}
                              onChange={event => updateStoryboardConfigDraft('userPromptTemplate', event.target.value)}
                              disabled={storyboardConfigSaving || workflowBusy}
                            />
                          </label>
                          <label className="inlineCheck">
                            <input
                              type="checkbox"
                              checked={storyboardConfigDraft.useFrameProfile !== false}
                              onChange={event => updateStoryboardConfigDraft('useFrameProfile', event.target.checked)}
                              disabled={storyboardConfigSaving || workflowBusy}
                            />
                            引用 Frame Profile 文档
                          </label>
                          <label>
                            <span>temperature</span>
                            <Input
                              type="number"
                              min="0"
                              max="2"
                              step="0.1"
                              value={storyboardConfigDraft.modelOptions?.temperature ?? 0.35}
                              onChange={event => updateStoryboardModelOption('temperature', Number(event.target.value))}
                              disabled={storyboardConfigSaving || workflowBusy}
                            />
                          </label>
                          <label className="inlineCheck">
                            <input
                              type="checkbox"
                              checked={storyboardConfigDraft.modelOptions?.stream !== false}
                              onChange={event => updateStoryboardModelOption('stream', event.target.checked)}
                              disabled={storyboardConfigSaving || workflowBusy}
                            />
                            流式调用
                          </label>
                          <div className="videoProjectActions">
                            <Button size="sm" variant="secondary" disabled={storyboardConfigSaving || workflowBusy || storyboardConfigPreviewing} onClick={restoreStoryboardConfig}>恢复默认</Button>
                            <Button size="sm" variant="secondary" disabled={storyboardConfigSaving || workflowBusy || storyboardConfigPreviewing} onClick={previewStoryboardMessages}>
                              {storyboardConfigPreviewing ? '预览中...' : '预览 messages'}
                            </Button>
                            <Button size="sm" disabled={storyboardConfigSaving || workflowBusy || storyboardConfigPreviewing} onClick={saveStoryboardConfig}>保存分镜 Agent 配置</Button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div className="agentOptionGroup">
                      <h4>视频渲染参数</h4>
                      <select
                        value={renderOptions.resolution}
                        onChange={event => updateRenderOption('resolution', event.target.value)}
                        disabled={workflowBusy}
                      >
                        <option value="1080x1920">1080x1920</option>
                        <option value="720x1280">720x1280</option>
                      </select>
                      <select
                        value={renderOptions.fps}
                        onChange={event => updateRenderOption('fps', event.target.value)}
                        disabled={workflowBusy}
                      >
                        <option value="24">24fps</option>
                        <option value="30">30fps</option>
                        <option value="60">60fps</option>
                      </select>
                      <select
                        value={renderOptions.captionSize}
                        onChange={event => updateRenderOption('captionSize', event.target.value)}
                        disabled={workflowBusy}
                      >
                        <option value="small">字幕小</option>
                        <option value="medium">字幕中</option>
                        <option value="large">字幕大</option>
                      </select>
                      <select
                        value={renderOptions.captionMode}
                        onChange={event => updateRenderOption('captionMode', event.target.value)}
                        disabled={workflowBusy}
                      >
                        <option value="phrase_kinetic">短语动效</option>
                        <option value="standard">标准字幕</option>
                        <option value="kinetic">逐词动效</option>
                      </select>
                      <select
                        value={renderOptions.motionLevel}
                        onChange={event => updateRenderOption('motionLevel', event.target.value)}
                        disabled={workflowBusy}
                      >
                        <option value="low">动效弱</option>
                        <option value="medium">动效中</option>
                        <option value="high">动效强</option>
                      </select>
                      <label className="inlineCheck">
                        <input
                          type="checkbox"
                          checked={renderOptions.showCaptionBar}
                          onChange={event => updateRenderOption('showCaptionBar', event.target.checked)}
                          disabled={workflowBusy}
                        />
                        显示字幕条
                      </label>
                      <label className="inlineCheck">
                        <input
                          type="checkbox"
                          checked={renderOptions.showSceneNumber}
                          onChange={event => updateRenderOption('showSceneNumber', event.target.checked)}
                          disabled={workflowBusy}
                        />
                        显示分镜编号
                      </label>
                      <select
                        value={renderOptions.quality}
                        onChange={event => updateRenderOption('quality', event.target.value)}
                        disabled={workflowBusy}
                      >
                        <option value="standard">标准质量</option>
                        <option value="high">高清质量</option>
                      </select>
                    </div>
                    {!hasTtsCaptions ? <p className="mutedText">请先在“配音”页签完成 TTS 合成并生成字幕时间轴。</p> : null}
                    {storyboardDraft?.scenes?.length ? (
                      <div className="storyboardList sceneEditorList">
                        {storyboardDraft.scenes.map(scene => {
                          const issues = storyboardSceneIssues[scene.index] || [];
                          const expanded = !!expandedStoryboardScenes[scene.index] || issues.length > 0;
                          return (
                            <details
                              className={`storyboardItem sceneEditorItem ${issues.length ? 'hasIssue' : ''}`}
                              key={scene.index}
                              open={expanded}
                              onToggle={event => {
                                if (event.currentTarget.open !== expanded) toggleStoryboardScene(scene.index);
                              }}
                            >
                              <summary className="sceneEditorSummary">
                                <div>
                                  <strong>分镜 {String(scene.index).padStart(2, '0')}</strong>
                                  <code>{formatCaptionTime(scene.start)} - {formatCaptionTime(scene.end)}</code>
                                </div>
                                <span>{scene.headline || '未填写标题'}</span>
                                {issues.length ? <em>{issues.join('，')}</em> : null}
                              </summary>
                              {issues.length ? (
                                <div className="sceneIssueActions">
                                  <span>{issues.join('，')}</span>
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    disabled={storyboardSaving || videoBusy}
                                    onClick={() => cleanStoryboardScene(scene.index)}
                                  >
                                    清理乱码字段
                                  </Button>
                                </div>
                              ) : null}
                              <Input
                                value={scene.headline || ''}
                                onChange={event => updateStoryboardScene(scene.index, 'headline', event.target.value)}
                                disabled={storyboardSaving || videoBusy}
                                placeholder="分镜标题"
                              />
                              <Input
                                value={(scene.caption_indexes || []).join(', ')}
                                onChange={event => updateStoryboardSceneIndexes(scene.index, event.target.value)}
                                disabled={storyboardSaving || videoBusy}
                                placeholder="字幕索引，例如 1, 2"
                              />
                              <select
                                value={scene.visual_type || 'text_card'}
                                onChange={event => updateStoryboardScene(scene.index, 'visual_type', event.target.value)}
                                disabled={storyboardSaving || videoBusy}
                              >
                                <option value="text_card">text_card</option>
                                <option value="quote_card">quote_card</option>
                                <option value="step_card">step_card</option>
                                <option value="contrast_card">contrast_card</option>
                              </select>
                              <select
                                value={['center_focus', 'split_emphasis', 'stacked_steps', 'compare_grid'].includes(scene.layout) ? scene.layout : 'center_focus'}
                                onChange={event => updateStoryboardScene(scene.index, 'layout', event.target.value)}
                                disabled={storyboardSaving || videoBusy}
                              >
                                <option value="center_focus">center_focus</option>
                                <option value="split_emphasis">split_emphasis</option>
                                <option value="stacked_steps">stacked_steps</option>
                                <option value="compare_grid">compare_grid</option>
                              </select>
                              <textarea
                                value={scene.background_prompt || ''}
                                onChange={event => updateStoryboardScene(scene.index, 'background_prompt', event.target.value)}
                                disabled={storyboardSaving || videoBusy}
                                placeholder="原创背景提示"
                              />
                              <Input
                                value={(scene.emphasis_words || []).join(', ')}
                                onChange={event => updateStoryboardSceneEmphasis(scene.index, event.target.value)}
                                disabled={storyboardSaving || videoBusy}
                                placeholder="强调词，用英文逗号或中文逗号分隔"
                              />
                            </details>
                          );
                        })}
                      </div>
                    ) : null}
                    {activeRun.video ? (
                      <div className="videoProjectMeta">
                        <span>{activeRun.video.message || '视频状态已更新。'}</span>
                        {activeRun.video.project_dir ? <code>{activeRun.video.project_dir}</code> : null}
                        {activeRun.video.video_quality_report ? (
                          <div className="qualityReportPanel">
                            <strong>质量评分：{activeRun.video.video_quality_report.score}</strong>
                            <span>目标时长：{activeRun.video.video_quality_report.target_duration_sec} 秒</span>
                            <span>
                              实际时长：
                              {activeRun.video.video_quality_report.duration?.toFixed?.(1) || activeRun.video.video_quality_report.duration}
                              {' '}秒
                            </span>
                            {activeRun.video.video_quality_report.issues?.map(issue => (
                              <p key={issue.code}>{issue.message}</p>
                            ))}
                            {hasFailedQualityReport ? (
                              <p className="mutedText">
                                请按工作流执行“{getWorkflowActionLabel(nextAction || 'compress_scene_narration')}”，先压缩超时分镜或重新配音，再继续生成成片。
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                        {activeRun.video.output_url ? (
                          <video controls src={activeRun.video.output_url} />
                        ) : null}
                      </div>
                    ) : null}
                    <div className="storyboardDebugPanel">
                      <Button size="sm" variant="secondary" onClick={() => setStoryboardDebugOpen(value => !value)}>
                        {storyboardDebugOpen ? '收起调试信息' : '展开调试信息'}
                      </Button>
                      {storyboardDebugOpen ? getStoryboardDebugSections(activeRun).map(section => (
                        <section className="agentResultSection" key={section.key}>
                          <h4>{section.title}</h4>
                          <pre>{section.text || '暂无内容'}</pre>
                        </section>
                      )) : null}
                    </div>
                  </div>
                </section>
              ) : null}
            </>
          ) : (
            <p className="mutedText">请选择历史运行，或先生成导演分镜创建新的成片流程记录。</p>
          )}
        </div>
      </section>
    </main>
  );
}
