export function retainedNarrationAttempts(media) {
  const accepted = new Set((media?.narrationAcceptances || []).map(item => item.attemptId));
  const files = new Map((media?.artifacts || []).map(file => [file.id, file]));
  return [...(media?.attempts || [])].reverse()
    .filter(attempt => attempt.stage === 'full_narration' && attempt.status !== 'validated' && !accepted.has(attempt.id))
    .map(attempt => ({ ...attempt, raw: files.get(attempt.received?.raw?.id), review: files.get(attempt.received?.review?.id) }))
    .filter(attempt => attempt.raw?.url);
}
