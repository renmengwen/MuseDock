export function SceneList({ scenes, selectedSceneId, onSelect, onMove, disabled }) {
  if (!scenes || scenes.length === 0) return null;

  const handleKeyDown = (e, sceneId) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(sceneId);
    }
  };

  return (
    <div className="one-click-editor-scene-list">
      <h3>场景列表</h3>
      {scenes.map((scene, index) => (
        <div
          key={scene.id}
          className={`scene-item ${scene.id === selectedSceneId ? 'selected' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(scene.id)}
          onKeyDown={(e) => handleKeyDown(e, scene.id)}
          aria-pressed={scene.id === selectedSceneId}
        >
          <span className="scene-label">场景 {index + 1}: {scene.id}</span>
          <div className="scene-actions">
            <button
              disabled={disabled || index === 0}
              onClick={(e) => { e.stopPropagation(); onMove(scene.id, 'up'); }}
              title="上移"
              aria-label={`上移场景 ${index + 1}`}
            >
              上移
            </button>
            <button
              disabled={disabled || index === scenes.length - 1}
              onClick={(e) => { e.stopPropagation(); onMove(scene.id, 'down'); }}
              title="下移"
              aria-label={`下移场景 ${index + 1}`}
            >
              下移
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
