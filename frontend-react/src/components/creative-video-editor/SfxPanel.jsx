import { EditorSection } from './editorUi.jsx';

function getEvents(project) {
  return Array.isArray(project?.audio?.sfx?.events) ? project.audio.sfx.events : [];
}

function getEventId(event) {
  return event?.id || event?.event_id || event?.sfx_id || '';
}

function getSceneLabel(event, frames, fallbackIndex) {
  const frameId = event?.frame_id || event?.scene_id || event?.frameId || event?.sceneId;
  const frameIndex = frames.findIndex(item => (
    String(item?.id) === String(frameId) || String(item?.scene_id) === String(frameId)
  ));
  const frame = frameIndex >= 0 ? frames[frameIndex] : null;
  const order = Number(frame?.order);
  return `场景 ${Number.isFinite(order) ? order : (frameIndex >= 0 ? frameIndex + 1 : fallbackIndex + 1)}`;
}

function getSortTime(event) {
  const value = event?.global_time_sec ?? event?.time_sec;
  const number = Number(value);
  return Number.isFinite(number) ? number : Number.POSITIVE_INFINITY;
}

function formatTime(event) {
  const timeSec = Number(event?.time_sec);
  if (Number.isFinite(timeSec)) return `${timeSec.toFixed(2)}s`;
  const globalTimeSec = Number(event?.global_time_sec);
  if (Number.isFinite(globalTimeSec)) return `全片 ${globalTimeSec.toFixed(2)}s`;
  return '未指定时间';
}

export function SfxPanel({
  project,
  frames = [],
  disabled,
  deletingSfxEventId = '',
  onDisableEvent,
}) {
  const events = getEvents(project);
  const visibleEvents = events
    .filter(event => event?.enabled !== false)
    .map((event, index) => ({ event, index }))
    .sort((a, b) => getSortTime(a.event) - getSortTime(b.event) || a.index - b.index);
  const deletedCount = events.length - visibleEvents.length;

  return (
    <div className="grid min-w-0 gap-2 text-sm text-[#4b5563]">
      <p className="m-0 text-xs leading-5 text-[#4b5563]">
        这些音效会在重新导出时混入成片。删除音效本身不会重新生成画面，但导出操作仍沿用当前导出链路。
      </p>

      {visibleEvents.length ? (
        <EditorSection className="overflow-hidden p-0">
          {visibleEvents.map(({ event, index }, rowIndex) => {
            const eventId = getEventId(event);
            const deleting = String(deletingSfxEventId) === String(eventId);
            return (
              <div className={`grid gap-2 px-3 py-3 ${rowIndex < visibleEvents.length - 1 ? 'border-b border-[#e5e7eb]' : ''}`} key={eventId || `sfx-${index}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[#111827]">
                      {event?.label_zh || event?.label || '未命名音效'}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[#6b7280]">
                      <span>{getSceneLabel(event, frames, index)}</span>
                      <span>时间：{formatTime(event)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="min-h-8 flex-none rounded-md border border-red-200 bg-white px-3 text-xs font-bold text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-55"
                    disabled={disabled || deleting || !eventId}
                    onClick={() => onDisableEvent?.(eventId)}
                  >
                    {deleting ? '删除中...' : '删除'}
                  </button>
                </div>
                {event?.reason ? (
                  <p className="m-0 text-xs leading-5 text-[#4b5563]">{event.reason}</p>
                ) : null}
              </div>
            );
          })}
        </EditorSection>
      ) : (
        <EditorSection>
          <p className="m-0 text-sm font-semibold text-[#111827]">当前工程还没有自动音效。</p>
          <p className="m-0 mt-1 text-xs text-[#6b7280]">开启“自动音效增强”后，新生成的视频会在这里显示可删除的音效。</p>
        </EditorSection>
      )}

      <div className="text-right text-xs text-[#6b7280]">
        共 {visibleEvents.length} 条，已删除 {deletedCount} 条
      </div>
    </div>
  );
}
