import { useEffect, useMemo, useRef, useState } from 'react';

function getDefaultVisibleIds(columns) {
  const defaults = columns.filter(column => column.defaultVisible !== false).map(column => column.id);
  return defaults.length ? defaults : columns.slice(0, 1).map(column => column.id);
}

function normalizeVisibleIds(value, columns) {
  const validIds = new Set(columns.map(column => column.id));
  const requiredIds = columns.filter(column => column.alwaysVisible).map(column => column.id);
  const normalized = Array.isArray(value)
    ? value.filter(id => typeof id === 'string' && validIds.has(id))
    : [];

  const visibleIds = normalized.length ? normalized : getDefaultVisibleIds(columns);
  return Array.from(new Set([...requiredIds, ...visibleIds]));
}

function areSameIds(a, b) {
  if (a.length !== b.length) return false;
  return a.every((id, index) => id === b[index]);
}

function readVisibleIds(storageKey, columns) {
  const defaultIds = getDefaultVisibleIds(columns);
  if (!storageKey || typeof window === 'undefined') {
    return defaultIds;
  }

  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return defaultIds;
    const parsedIds = JSON.parse(raw);
    const savedIds = normalizeVisibleIds(parsedIds, columns);
    const knownIds = new Set(Array.isArray(parsedIds) ? parsedIds.filter(id => typeof id === 'string') : []);
    const addedDefaultIds = defaultIds.filter(id => !knownIds.has(id));
    return Array.from(new Set([...savedIds, ...addedDefaultIds]));
  } catch {
    return defaultIds;
  }
}

export function useColumnVisibility(columns, storageKey) {
  const columnSignature = useMemo(
    () => columns.map(column => `${column.id}:${column.defaultVisible === false ? '0' : '1'}`).join('|'),
    [columns],
  );
  const stateScopeRef = useRef({ storageKey, columnSignature });
  const pendingScopeRef = useRef(null);
  const [visibleIds, setVisibleIds] = useState(() => readVisibleIds(storageKey, columns));

  useEffect(() => {
    const next = readVisibleIds(storageKey, columns);
    pendingScopeRef.current = { storageKey, columnSignature, visibleIds: next };
    setVisibleIds(current => {
      return areSameIds(current, next) ? current : next;
    });
  }, [storageKey, columnSignature]);

  useEffect(() => {
    if (!storageKey || typeof window === 'undefined') return;

    const scope = stateScopeRef.current;
    if (!scope || scope.storageKey !== storageKey || scope.columnSignature !== columnSignature) {
      const pendingScope = pendingScopeRef.current;
      if (
        !pendingScope
        || pendingScope.storageKey !== storageKey
        || pendingScope.columnSignature !== columnSignature
        || !areSameIds(visibleIds, pendingScope.visibleIds)
      ) {
        return;
      }

      stateScopeRef.current = { storageKey, columnSignature };
      pendingScopeRef.current = null;
    }

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(visibleIds));
    } catch {
      // localStorage may be unavailable in private or restricted browser contexts.
    }
  }, [storageKey, columnSignature, visibleIds]);

  const visibleColumns = useMemo(
    () => columns.filter(column => visibleIds.includes(column.id)),
    [columns, visibleIds],
  );

  function setColumnVisible(columnId, visible) {
    setVisibleIds(current => {
      const next = visible
        ? Array.from(new Set([...current, columnId]))
        : current.filter(id => id !== columnId);
      const normalized = normalizeVisibleIds(next, columns);

      return areSameIds(current, normalized) ? current : normalized;
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
