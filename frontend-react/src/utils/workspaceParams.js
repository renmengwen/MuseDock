export function getAwemeIdFromSearch(search = '') {
  const params = new URLSearchParams(search);
  return (params.get('aweme_id') || params.get('awemeId') || '').trim();
}
