export function SceneList({ scenes = [], selectedSceneId, disabled, onSelect }) {
  return (
    <aside className="creative-video-editor-scene-list" aria-label="场景列表">
      <h3>场景</h3>
      {scenes.length ? scenes.map((scene, index) => (
        <button
          type="button"
          key={scene.id}
          className={scene.id === selectedSceneId ? 'active' : ''}
          disabled={disabled}
          onClick={() => onSelect(scene.id)}
        >
          <span>场景 {index + 1}</span>
          <strong>{scene.visual_text?.headline || scene.id}</strong>
        </button>
      )) : <p>暂无场景</p>}
    </aside>
  );
}
