export function HtmlVideoElementInspector({
  elementInfo,
  editingReady,
  disabled,
  saving,
  onTextChange,
  onResetPosition,
  onSaveDraft,
  onRenderDraft,
  activeDraftId,
}) {
  return (
    <aside className="creative-video-editor-panel html-video-element-inspector" aria-label="元素属性">
      <div className="creative-video-editor-panel-header">
        <h3>当前元素</h3>
      </div>
      {!editingReady ? (
        <p>镜头播放完毕后可选择并拖拽元素。</p>
      ) : null}
      {editingReady && !elementInfo ? (
        <p>点击画面中的标题、标签或正文元素开始编辑。</p>
      ) : null}
      {editingReady && elementInfo ? (
        <>
          <dl>
            <div>
              <dt>标识</dt>
              <dd>{elementInfo.label}</dd>
            </div>
            <div>
              <dt>选择器</dt>
              <dd>{elementInfo.selector}</dd>
            </div>
            <div>
              <dt>位置</dt>
              <dd>
                {Math.round(elementInfo.left)} / {Math.round(elementInfo.top)}
              </dd>
            </div>
            <div>
              <dt>尺寸</dt>
              <dd>
                {Math.round(elementInfo.width)} × {Math.round(elementInfo.height)}
              </dd>
            </div>
          </dl>
          <label>
            文案
            <textarea
              value={elementInfo.text || ''}
              disabled={disabled}
              rows={4}
              onChange={event => onTextChange?.(event.target.value)}
            />
          </label>
          <div className="creative-video-editor-inline-actions">
            <button type="button" disabled={disabled || saving} onClick={onResetPosition}>重置位置</button>
            <button type="button" disabled={disabled || saving} onClick={onSaveDraft}>
              {saving ? '正在保存...' : '保存为草稿'}
            </button>
            <button type="button" disabled={disabled || saving || !activeDraftId} onClick={onRenderDraft}>渲染草稿</button>
          </div>
        </>
      ) : null}
    </aside>
  );
}
