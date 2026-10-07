export function sceneImageGenerationStatus(scene, illustrated) {
  const operation = illustrated?.operation;
  if (operation?.type !== 'images' || !['queued', 'running'].includes(operation.status)) return '';
  const sceneIds = operation.sceneIds || [];
  const index = sceneIds.indexOf(scene.id);
  if (index < 0 || (scene.selected && !operation.regenerate)) return '';
  if (operation.status === 'queued') return 'queued';
  const queued = operation.progress?.queued ?? sceneIds.length;
  const activeIndex = sceneIds.length - queued - 1;
  if (index === activeIndex && operation.progress?.running > 0) return 'running';
  return index > activeIndex ? 'queued' : '';
}
