export function shouldAutoPrepareMedia(item = {}) {
  return item?.media_status?.ready !== true;
}
