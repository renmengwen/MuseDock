import { useEffect, useMemo, useState } from 'react';

function getDefaultVisibleIds(columns) {
  const defaults = columns.filter(column => column.defaultVisible !== false).map(column => column.id);
  return defaults.length ? defaults : columns.slice(0, 1).map(column => column.id);
}

function normalizeVisibleIds(value, columns) {
  const validIds = new Set(columns.map(column => column.id));
  const normalized = Array.isArray(value)
    ? value.filter(id => typeof id === 'string' && validIds.has(id))
    : [];

  return normalized.length ? normalized : getDefaultVisibleIds(columns);
}

function readVisibleIds(storageKey, columns) {
  if (!storageKey || typeof window === 'undefined') {
    return getDefaultVisibleIds(columns);
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    return normalizeVisibleIds(raw ? JSON.parse(raw) : null, columns);
  } catch {
    return getDefaultVisibleIds(columns);
  }
}

export function useColumnVisibility(columns, storageKey) {
  const columnIds = useMemo(() => columns.map(column => column.id).join('|'), [columns]);
  const [visibleIds, setVisibleIds] = useState(() => readVisibleIds(storageKey, columns));

  useEffect(() => {
    setVisibleIds(current => normalizeVisibleIds(current, columns));
  }, [columnIds, columns]);

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(visibleIds));
    } catch {
      // localStorage may be unavailable in private or restricted browser contexts.
    }
  }, [storageKey, visibleIds]);

  const visibleColumns = useMemo(
    () => columns.filter(column => visibleIds.includes(column.id)),
    [columns, visibleIds],
  );

  function setColumnVisible(columnId, visible) {
    setVisibleIds(current => {
      const next = visible
        ? Array.from(new Set([...current, columnId]))
        : current.filter(id => id !== columnId);

      return normalizeVisibleIds(next, columns);
    });
  }

  function isColumnVisible(columnId) {
    return visibleIds.includes(columnId);
  }

  return {
    visibleIds,
    visibleColumns,
    isColumnVisible,
    setColumnVisible,
  };
}
