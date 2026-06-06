let selectedMediaItem = null;
let shouldAutoPrepare = false;

export function setSelectedMediaItem(item, options = {}) {
  selectedMediaItem = item || null;
  shouldAutoPrepare = !!options.autoPrepare;
}

export function getSelectedMediaItem() {
  return selectedMediaItem;
}

export function consumeAutoPrepareFlag() {
  const value = shouldAutoPrepare;
  shouldAutoPrepare = false;
  return value;
}
