import { Button } from '@/components/ui/button.jsx';

export function CreativeVideoPreview({ videoUrl, onEdit, disabled, title }) {
  return (
    <section className="creativeVideoStage" aria-label="生成视频预览">
      <video className="creativeResultVideo" src={videoUrl} controls playsInline preload="metadata">
        当前浏览器不支持直接播放视频。
      </video>
      <Button className="editorToggle" type="button" onClick={onEdit} disabled={disabled} title={title}>
        继续编辑
      </Button>
    </section>
  );
}
