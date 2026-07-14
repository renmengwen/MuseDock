function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function updateHeadline(inputs, title) {
  const nextInputs = { ...objectOrEmpty(inputs) };
  if (title || Object.prototype.hasOwnProperty.call(nextInputs, 'headline')) {
    nextInputs.headline = title;
  }
  return nextInputs;
}

export function buildFrameSavePayload(draft = {}) {
  const headline = draft.headline || draft.title || '';
  const inputs = updateHeadline(draft.inputs, headline);
  const duration = Number(draft.duration_sec);
  const payload = {
    type: 'frame_patch',
    frame_id: draft.id || draft.scene_id,
    narration_text: draft.narration_text || '',
    inputs: inputs || {},
    metadata_patch: {
      visual_text: {
        headline,
      },
    },
  };
  if (draft.duration_sec !== '' && Number.isFinite(duration) && duration > 0) {
    payload.duration_sec = duration;
  }
  return payload;
}

export { updateHeadline };
