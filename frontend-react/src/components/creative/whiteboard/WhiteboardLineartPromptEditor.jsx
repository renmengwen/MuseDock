import { useEffect, useRef, useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { Textarea } from '@/components/ui/textarea.jsx';

export function WhiteboardLineartPromptEditor({ scene, onSave, disabled = false, onSavingChange }) {
  const prompt = scene.prompt;
  const [saved, setSaved] = useState(prompt);
  const [imagePrompt, setImagePrompt] = useState(prompt.imagePrompt);
  const [revision, setRevision] = useState(prompt.revision || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const savingRef = useRef(false);
  const dirty = imagePrompt !== saved.imagePrompt || revision !== (saved.revision || '');
  const stale = prompt.identity !== saved.identity;
  const valid = imagePrompt.trim().length >= 8 && imagePrompt.length <= 6000
    && !/同上|沿用上一幕|参见上一幕/.test(imagePrompt) && revision.length <= 3000;
  const id = `lineart-prompt-${scene.sceneId}`;

  useEffect(() => {
    if (stale && !dirty && !saving) {
      setSaved(prompt); setImagePrompt(prompt.imagePrompt); setRevision(prompt.revision || '');
    }
  }, [prompt, stale, dirty, saving]);

  function reloadSaved() {
    setSaved(prompt); setImagePrompt(prompt.imagePrompt); setRevision(prompt.revision || '');
    setError(''); setNotice('已载入保存的提示词。');
  }

  async function save(event) {
    event.preventDefault();
    if (savingRef.current || disabled || !onSave || !dirty || !valid || stale || !saved.identity) return;
    savingRef.current = true;
    setSaving(true); onSavingChange?.(true); setError(''); setNotice('');
    try {
      const next = await onSave(scene.sceneId, { imagePrompt: imagePrompt.trim(), revision: revision.trim(), expectedPromptIdentity: saved.identity });
      setSaved(next); setImagePrompt(next.imagePrompt); setRevision(next.revision || '');
      setNotice(next.pending ? '已保存。本轮结束后会应用修改，再继续制作即可使用新提示词。' : '已保存，继续制作时会使用新提示词。');
    } catch (failure) {
      setError(failure?.data?.message || failure?.message || '保存提示词失败，请检查服务连接后重试。');
    } finally {
      savingRef.current = false;
      setSaving(false); onSavingChange?.(false);
    }
  }

  return <form aria-label="编辑线稿提示词" className="grid min-w-0 gap-3" onSubmit={save}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <label htmlFor={id} className="text-sm font-semibold text-fg-1">线稿提示词</label>
      <span className="text-xs text-fg-3">{imagePrompt.length} / 6000</span>
    </div>
    <Textarea id={id} value={imagePrompt} rows={7} maxLength={6000} disabled={saving}
      onChange={event => { setImagePrompt(event.target.value); setError(''); setNotice(''); }}
      className="min-h-[180px] resize-y bg-surface-1 text-sm leading-7" />
    {saved.revision || revision ? <div className="grid gap-2">
      <label htmlFor={`${id}-revision`} className="text-xs font-semibold text-fg-2">附加修改要求（可编辑或清空）</label>
      <Textarea id={`${id}-revision`} value={revision} rows={2} maxLength={3000} disabled={saving}
        onChange={event => { setRevision(event.target.value); setError(''); setNotice(''); }} className="resize-y bg-surface-1 text-sm leading-6" />
    </div> : null}
    <p className="m-0 text-xs leading-6 text-fg-3">在这里修改本幕画面描述，画幅与视觉模板设置继续生效。保存后再继续制作；本幕已有线稿和后续动画需要重新生成，其他分镜与旁白会保留。</p>
    {prompt.pending ? <p className="m-0 text-xs leading-6 text-fg-3">修改已保存，当前这轮请求仍使用原提示词；本轮结束后会应用修改。</p> : null}
    {stale && dirty ? <p role="alert" className="m-0 text-xs leading-6 text-danger">本幕已保存内容有更新。你的编辑仍保留，请先复制需要保留的文字，再重新载入已保存内容。</p> : null}
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" size="sm" disabled={saving || disabled || !onSave || !saved.identity || !dirty || !valid || stale}>
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{saving ? '正在保存提示词...' : '保存提示词'}
      </Button>
      {dirty || stale ? <Button type="button" size="sm" variant="outline" disabled={saving} onClick={reloadSaved}>重新载入已保存内容</Button> : null}
    </div>
    {dirty && !valid ? <p className="m-0 text-xs leading-6 text-danger">请填写 8–6000 个字符的完整画面描述，不要引用上一幕；附加修改要求最多 3000 个字符。</p> : null}
    {saving || notice ? <p role="status" className="m-0 text-xs leading-6 text-fg-2">{saving ? '正在保存本幕线稿提示词...' : notice}</p> : null}
    {error ? <p role="alert" className="m-0 text-sm leading-6 text-danger">{error}</p> : null}
  </form>;
}
