# shadcn/ui Tailwind Table Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce Tailwind CSS and shadcn-style UI primitives while preserving the current visual style, then add sticky headers and locally persisted column visibility to crawl and records tables.

**Architecture:** Keep existing React pages and business flows, add a small UI primitive layer under `frontend-react/src/components/ui/`, and move table rendering into a reusable configurable table component. Column visibility is stored in `localStorage` with page/platform-specific keys and falls back safely when storage is unavailable or stale.

**Tech Stack:** React 19, Vite 8, Tailwind CSS, shadcn-style component primitives, `localStorage`, existing REST API client.

---

## File Structure

- Create `frontend-react/tailwind.config.js`: Tailwind content paths and theme colors matching the current MuseDock red/gray style.
- Create `frontend-react/postcss.config.js`: Tailwind and autoprefixer PostCSS plugins.
- Create `frontend-react/jsconfig.json`: `@/*` alias for frontend source imports.
- Modify `frontend-react/vite.config.js`: add `@` alias for `frontend-react/src`.
- Modify `frontend-react/src/styles.css`: add Tailwind directives, CSS variables, and preserve existing visual rules during migration.
- Create `frontend-react/src/lib/utils.js`: `cn()` class name helper.
- Create `frontend-react/src/components/ui/button.jsx`: shared button primitive.
- Create `frontend-react/src/components/ui/input.jsx`: shared input primitive.
- Create `frontend-react/src/components/ui/select.jsx`: shared select primitive.
- Create `frontend-react/src/components/ui/dropdown-menu.jsx`: lightweight shadcn-style dropdown primitive for column settings.
- Create `frontend-react/src/components/ui/table.jsx`: shared table primitive.
- Create `frontend-react/src/components/data-table/useColumnVisibility.js`: load, validate, update, and persist visible column ids.
- Create `frontend-react/src/components/data-table/ConfigurableTable.jsx`: sticky-header configurable table with column settings.
- Modify `frontend-react/src/components/ContentTable.jsx`: define platform-specific columns and render `ConfigurableTable`.
- Modify `frontend-react/src/pages/CrawlPage.jsx`: pass a `storageKey` for crawl table and migrate toolbar controls to UI primitives.
- Modify `frontend-react/src/pages/RecordsPage.jsx`: pass a `storageKey` for records table and migrate toolbar controls to UI primitives.
- Optional later migration: `LoginModal.jsx`, `CommentModal.jsx`, `SettingsPage.jsx`, and `Status.jsx` can move to UI primitives after the table work is stable.

## Task 1: Add Tailwind And shadcn-Style Foundation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `frontend-react/tailwind.config.js`
- Create: `frontend-react/postcss.config.js`
- Create: `frontend-react/jsconfig.json`
- Modify: `frontend-react/vite.config.js`
- Modify: `frontend-react/src/styles.css`
- Create: `frontend-react/src/lib/utils.js`

- [ ] **Step 1: Confirm branch and inspect dirty files**

Run:

```powershell
git branch --show-current
git status --short
```

Expected: branch is `dev`. Existing dirty files may be present; do not revert unrelated user changes.

- [ ] **Step 2: Install Tailwind dependencies**

Run:

```powershell
npm install -D tailwindcss postcss autoprefixer
npm install class-variance-authority clsx tailwind-merge lucide-react
```

Expected: `package.json` and `package-lock.json` include Tailwind and utility dependencies.

- [ ] **Step 3: Add Tailwind config**

Create `frontend-react/tailwind.config.js`:

```js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 4: Add PostCSS config**

Create `frontend-react/postcss.config.js`:

```js
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
```

- [ ] **Step 5: Add frontend path alias config**

Create `frontend-react/jsconfig.json`:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["src/*"]
    }
  }
}
```

- [ ] **Step 6: Add Vite alias**

Modify `frontend-react/vite.config.js` to include:

```js
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('.', import.meta.url));
const src = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  resolve: {
    alias: {
      '@': src,
    },
  },
  build: {
    outDir: '../frontend-dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
```

- [ ] **Step 7: Add Tailwind directives and theme variables**

Modify the top of `frontend-react/src/styles.css` so it starts with:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 220 20% 97%;
    --foreground: 220 12% 19%;
    --card: 0 0% 100%;
    --card-foreground: 220 12% 19%;
    --popover: 0 0% 100%;
    --popover-foreground: 220 12% 19%;
    --primary: 347 99% 58%;
    --primary-foreground: 0 0% 100%;
    --secondary: 220 16% 95%;
    --secondary-foreground: 220 12% 21%;
    --muted: 210 25% 98%;
    --muted-foreground: 219 10% 42%;
    --accent: 347 100% 98%;
    --accent-foreground: 347 99% 58%;
    --destructive: 0 68% 47%;
    --destructive-foreground: 0 0% 100%;
    --border: 220 18% 90%;
    --input: 220 18% 90%;
    --ring: 347 99% 58%;
    --radius: 8px;
  }
}
```

Keep the existing CSS rules below these directives so current visuals remain close during migration.

- [ ] **Step 8: Add `cn` helper**

Create `frontend-react/src/lib/utils.js`:

```js
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 9: Verify foundation build**

Run:

```powershell
npm run build:frontend
```

Expected: Vite build completes successfully.

- [ ] **Step 10: Commit foundation**

Run:

```powershell
git add -- package.json package-lock.json frontend-react/tailwind.config.js frontend-react/postcss.config.js frontend-react/jsconfig.json frontend-react/vite.config.js frontend-react/src/styles.css frontend-react/src/lib/utils.js
git commit -m "引入 Tailwind 与 UI 基础配置"
```

## Task 2: Add UI Primitives

**Files:**
- Create: `frontend-react/src/components/ui/button.jsx`
- Create: `frontend-react/src/components/ui/input.jsx`
- Create: `frontend-react/src/components/ui/select.jsx`
- Create: `frontend-react/src/components/ui/dropdown-menu.jsx`
- Create: `frontend-react/src/components/ui/table.jsx`

- [ ] **Step 1: Add button primitive**

Create `frontend-react/src/components/ui/button.jsx`:

```jsx
import * as React from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils.js';

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        login: 'bg-[#ff9800] text-white hover:bg-[#ef8f00]',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        default: 'h-10 px-[18px]',
        sm: 'h-[30px] px-2.5 text-xs',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export const Button = React.forwardRef(function Button({ className, variant, size, ...props }, ref) {
  return <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});

export { buttonVariants };
```

- [ ] **Step 2: Add input primitive**

Create `frontend-react/src/components/ui/input.jsx`:

```jsx
import * as React from 'react';
import { cn } from '@/lib/utils.js';

export const Input = React.forwardRef(function Input({ className, type = 'text', ...props }, ref) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-white px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    />
  );
});
```

- [ ] **Step 3: Add select primitive**

Create `frontend-react/src/components/ui/select.jsx`:

```jsx
import * as React from 'react';
import { cn } from '@/lib/utils.js';

export const Select = React.forwardRef(function Select({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        'h-10 min-w-[158px] rounded-md border border-input bg-white px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});
```

- [ ] **Step 4: Add dropdown menu primitive**

Create `frontend-react/src/components/ui/dropdown-menu.jsx`:

```jsx
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils.js';

export function DropdownMenu({ trigger, children, align = 'right', className }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  return (
    <div className="relative inline-flex" ref={ref}>
      <div onClick={() => setOpen(value => !value)}>{trigger}</div>
      {open ? (
        <div
          className={cn(
            'absolute top-full z-30 mt-2 min-w-[180px] rounded-md border border-border bg-popover p-2 text-sm text-popover-foreground shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function DropdownMenuCheckboxItem({ checked, disabled, onCheckedChange, children }) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input
        type="checkbox"
        className="h-4 w-4 accent-[#fe2c55]"
        checked={checked}
        disabled={disabled}
        onChange={event => onCheckedChange?.(event.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}
```

- [ ] **Step 5: Add table primitive**

Create `frontend-react/src/components/ui/table.jsx`:

```jsx
import * as React from 'react';
import { cn } from '@/lib/utils.js';

export const Table = React.forwardRef(function Table({ className, ...props }, ref) {
  return <table ref={ref} className={cn('w-full border-collapse bg-white text-sm', className)} {...props} />;
});

export const TableHeader = React.forwardRef(function TableHeader({ className, ...props }, ref) {
  return <thead ref={ref} className={cn(className)} {...props} />;
});

export const TableBody = React.forwardRef(function TableBody({ className, ...props }, ref) {
  return <tbody ref={ref} className={cn(className)} {...props} />;
});

export const TableRow = React.forwardRef(function TableRow({ className, ...props }, ref) {
  return <tr ref={ref} className={cn('border-b border-border', className)} {...props} />;
});

export const TableHead = React.forwardRef(function TableHead({ className, ...props }, ref) {
  return (
    <th
      ref={ref}
      className={cn('sticky top-0 z-10 bg-[#fafbfc] px-3.5 py-3 text-left align-top text-[13px] font-semibold text-[#5f6876]', className)}
      {...props}
    />
  );
});

export const TableCell = React.forwardRef(function TableCell({ className, ...props }, ref) {
  return <td ref={ref} className={cn('px-3.5 py-3 align-top text-[13px]', className)} {...props} />;
});
```

- [ ] **Step 6: Verify UI primitive build**

Run:

```powershell
npm run build:frontend
```

Expected: build succeeds.

- [ ] **Step 7: Commit UI primitives**

Run:

```powershell
git add -- frontend-react/src/components/ui
git commit -m "添加前端基础 UI 组件"
```

## Task 3: Add Configurable Table And Persistence

**Files:**
- Create: `frontend-react/src/components/data-table/useColumnVisibility.js`
- Create: `frontend-react/src/components/data-table/ConfigurableTable.jsx`
- Optional test helper command: `npm run build:frontend`

- [ ] **Step 1: Add column visibility hook**

Create `frontend-react/src/components/data-table/useColumnVisibility.js`:

```js
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
```

- [ ] **Step 2: Add configurable table component**

Create `frontend-react/src/components/data-table/ConfigurableTable.jsx`:

```jsx
import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import { DropdownMenu, DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu.jsx';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table.jsx';
import { cn } from '@/lib/utils.js';
import { useColumnVisibility } from './useColumnVisibility.js';

export function ConfigurableTable({
  columns,
  data,
  getRowKey,
  storageKey,
  emptyText = '暂无数据',
  className,
}) {
  const {
    visibleColumns,
    isColumnVisible,
    setColumnVisible,
    visibleIds,
  } = useColumnVisibility(columns, storageKey);

  if (!data.length) {
    return <div className="empty">{emptyText}</div>;
  }

  return (
    <section className={cn('tableShell', className)}>
      <div className="mb-2 flex justify-end">
        <DropdownMenu
          trigger={(
            <Button type="button" variant="secondary" size="sm" aria-label="配置表格列">
              <Settings2 className="mr-1.5 h-4 w-4" />
              列设置
            </Button>
          )}
        >
          {columns.map(column => {
            const checked = isColumnVisible(column.id);
            const disableHide = checked && visibleIds.length <= 1;
            return (
              <DropdownMenuCheckboxItem
                key={column.id}
                checked={checked}
                disabled={disableHide}
                onCheckedChange={checkedValue => setColumnVisible(column.id, checkedValue)}
              >
                {column.label}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenu>
      </div>

      <div className="tableScroll">
        <Table>
          <TableHeader>
            <TableRow>
              {visibleColumns.map(column => (
                <TableHead key={column.id} className={column.headerClassName || column.className}>
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((item, index) => (
              <TableRow key={getRowKey(item, index)}>
                {visibleColumns.map(column => (
                  <TableCell key={column.id} className={column.cellClassName || column.className}>
                    {column.render(item, index)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Add shell styles for scroll and sticky behavior**

Append to `frontend-react/src/styles.css`:

```css
.tableShell { width: 100%; }
.tableScroll { max-height: 62vh; overflow: auto; border-radius: 8px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.tableScroll table { box-shadow: none; border-radius: 0; min-width: 980px; }
.tableScroll th { position: sticky; top: 0; z-index: 10; }
```

- [ ] **Step 4: Verify configurable table build**

Run:

```powershell
npm run build:frontend
```

Expected: build succeeds.

- [ ] **Step 5: Commit configurable table**

Run:

```powershell
git add -- frontend-react/src/components/data-table frontend-react/src/styles.css
git commit -m "添加可配置表格组件"
```

## Task 4: Migrate ContentTable To Configurable Columns

**Files:**
- Modify: `frontend-react/src/components/ContentTable.jsx`

- [ ] **Step 1: Replace table rendering with column definitions**

Modify `frontend-react/src/components/ContentTable.jsx` to:

```jsx
import { Button } from '@/components/ui/button.jsx';
import { ConfigurableTable } from './data-table/ConfigurableTable.jsx';
import { formatTime, getDouyinAwemeId, getDouyinUrl } from '../utils/format.js';
import { formatDuration, getContentTypeLabel } from '../utils/content.js';

function createDouyinColumns(onComments, onPrepareMedia) {
  return [
    {
      id: 'title',
      label: '标题',
      className: 'min-w-[260px] max-w-[430px] break-words',
      render: item => item.title || item.description || '-',
    },
    {
      id: 'type',
      label: '类型',
      className: 'min-w-[88px]',
      render: item => getContentTypeLabel(item, 'douyin'),
    },
    {
      id: 'duration',
      label: '视频时长',
      className: 'min-w-[96px]',
      render: item => formatDuration(item),
    },
    {
      id: 'author',
      label: '作者',
      className: 'min-w-[120px]',
      render: item => item.author || item.nickname || item.author?.nickname || '-',
    },
    {
      id: 'createdAt',
      label: '发布日期',
      className: 'min-w-[136px]',
      render: item => formatTime(item.create_time),
    },
    {
      id: 'crawledAt',
      label: '抓取日期',
      className: 'min-w-[136px]',
      render: item => formatTime(item.crawled_at),
    },
    {
      id: 'likes',
      label: '点赞',
      className: 'min-w-[80px]',
      render: item => item.likes || item.liked_count || item.statistics?.digg_count || 0,
    },
    {
      id: 'comments',
      label: '评论',
      className: 'min-w-[80px]',
      render: item => item.comment_count || item.statistics?.comment_count || 0,
    },
    {
      id: 'link',
      label: '链接',
      className: 'min-w-[72px]',
      render: item => <a href={getDouyinUrl(item)} target="_blank" rel="noreferrer">打开</a>,
    },
    {
      id: 'actions',
      label: '操作',
      className: 'min-w-[168px]',
      render: item => {
        const awemeId = getDouyinAwemeId(item);
        return (
          <div className="actionCell">
            <Button variant="secondary" size="sm" disabled={!awemeId} onClick={() => onComments(awemeId)}>评论</Button>
            <Button size="sm" disabled={!awemeId} onClick={() => onPrepareMedia(item)}>准备 AI 素材</Button>
          </div>
        );
      },
    },
  ];
}

function createXhsColumns() {
  return [
    {
      id: 'cover',
      label: '封面',
      className: 'min-w-[96px]',
      render: item => (item.cover_url ? <img className="cover" src={item.cover_url} alt="" /> : '-'),
    },
    {
      id: 'title',
      label: '标题',
      className: 'min-w-[260px] max-w-[430px] break-words',
      render: item => item.title || item.description || '-',
    },
    {
      id: 'type',
      label: '类型',
      className: 'min-w-[88px]',
      render: item => getContentTypeLabel(item, 'xhs'),
    },
    {
      id: 'duration',
      label: '视频时长',
      className: 'min-w-[96px]',
      render: item => formatDuration(item),
    },
    {
      id: 'createdAt',
      label: '发布日期',
      className: 'min-w-[136px]',
      render: item => formatTime(item.publish_time || item.create_time || item.last_update_time),
    },
    {
      id: 'crawledAt',
      label: '抓取日期',
      className: 'min-w-[136px]',
      render: item => formatTime(item.crawled_at),
    },
    {
      id: 'likes',
      label: '点赞',
      className: 'min-w-[80px]',
      render: item => item.liked_count || 0,
    },
    {
      id: 'comments',
      label: '评论',
      className: 'min-w-[80px]',
      render: item => item.comment_count || 0,
    },
    {
      id: 'collections',
      label: '收藏',
      className: 'min-w-[80px]',
      render: item => item.collected_count || 0,
    },
    {
      id: 'link',
      label: '链接',
      className: 'min-w-[72px]',
      render: item => <a href={item.note_url || '#'} target="_blank" rel="noreferrer">打开</a>,
    },
  ];
}

function getRowKey(platform, item, index) {
  if (platform === 'douyin') {
    return getDouyinAwemeId(item) || item.url || item.aweme_url || index;
  }
  return item.note_id || item.note_url || index;
}

export function ContentTable({ platform, data, onComments, onPrepareMedia, storageKey }) {
  const columns = platform === 'douyin'
    ? createDouyinColumns(onComments, onPrepareMedia)
    : createXhsColumns();

  return (
    <ConfigurableTable
      columns={columns}
      data={data}
      getRowKey={(item, index) => getRowKey(platform, item, index)}
      storageKey={storageKey}
      emptyText="暂无数据"
    />
  );
}
```

- [ ] **Step 2: Verify migrated table build**

Run:

```powershell
npm run build:frontend
```

Expected: build succeeds and no unresolved imports.

- [ ] **Step 3: Commit table migration**

Run:

```powershell
git add -- frontend-react/src/components/ContentTable.jsx
git commit -m "迁移内容列表为可配置表格"
```

## Task 5: Wire Crawl And Records Pages To Shared Components

**Files:**
- Modify: `frontend-react/src/pages/CrawlPage.jsx`
- Modify: `frontend-react/src/pages/RecordsPage.jsx`

- [ ] **Step 1: Migrate CrawlPage toolbar controls and table storage key**

Modify imports in `frontend-react/src/pages/CrawlPage.jsx`:

```jsx
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
import { Select } from '@/components/ui/select.jsx';
```

Replace toolbar controls with:

```jsx
<div className="toolbar">
  <Input
    value={inputValue}
    onChange={event => setInputValue(event.target.value)}
    onKeyDown={event => event.key === 'Enter' && runCrawl()}
    placeholder={MODE_PLACEHOLDER[crawlMode]}
  />
  <Input
    className="countInput"
    type="number"
    min="1"
    max="100"
    value={max}
    onChange={event => setMax(event.target.value)}
  />
  <Select
    value={crawlMode}
    onChange={handleModeChange}
    disabled={loading || platform === 'xhs'}
  >
    {CRAWL_MODES.map(mode => (
      <option key={mode.value} value={mode.value}>{mode.label}</option>
    ))}
  </Select>
  <Button disabled={!canRunCrawl} onClick={runCrawl}>{getActionLabel()}</Button>
  {platform === 'douyin' ? <Button variant="login" onClick={login.startLogin}>扫码登录</Button> : null}
</div>
```

Replace title search input with:

```jsx
<Input
  value={titleQuery}
  onChange={event => setTitleQuery(event.target.value)}
  placeholder="按标题搜索"
  aria-label="按标题搜索"
/>
```

Pass storage key to `ContentTable`:

```jsx
<ContentTable
  platform={platform}
  data={filteredResults}
  onComments={comments.loadComments}
  onPrepareMedia={prepareMedia}
  storageKey={`musedock:table-columns:crawl:${platform}`}
/>
```

- [ ] **Step 2: Migrate RecordsPage toolbar controls and table storage key**

Modify imports in `frontend-react/src/pages/RecordsPage.jsx`:

```jsx
import { Button } from '@/components/ui/button.jsx';
import { Input } from '@/components/ui/input.jsx';
```

Replace refresh button:

```jsx
<Button variant="secondary" disabled={loading} onClick={loadHistory}>
  {loading ? '加载中...' : '刷新记录'}
</Button>
```

Replace title search input:

```jsx
<Input
  value={titleQuery}
  onChange={event => setTitleQuery(event.target.value)}
  placeholder="按标题搜索"
  aria-label="按标题搜索"
/>
```

Pass storage key to `ContentTable`:

```jsx
<ContentTable
  platform={platform}
  data={filteredResults}
  onComments={comments.loadComments}
  onPrepareMedia={prepareMedia}
  storageKey={`musedock:table-columns:records:${platform}`}
/>
```

- [ ] **Step 3: Verify page migration build**

Run:

```powershell
npm run build:frontend
```

Expected: build succeeds.

- [ ] **Step 4: Commit page wiring**

Run:

```powershell
git add -- frontend-react/src/pages/CrawlPage.jsx frontend-react/src/pages/RecordsPage.jsx
git commit -m "接入抓取与记录表格列配置"
```

## Task 6: Browser Verification And Polish

**Files:**
- Modify only files required to fix verified issues.

- [ ] **Step 1: Start frontend dev server**

Run:

```powershell
npm run dev:frontend
```

Expected: Vite serves `http://localhost:5173`.

- [ ] **Step 2: Open crawl page in browser**

Open:

```text
http://localhost:5173/crawl/douyin
```

Verify:

- Existing header and navigation still look close to the previous UI.
- Toolbar controls align in one row on desktop.
- Empty state displays `暂无数据`.

- [ ] **Step 3: Verify crawl table behavior with data**

Use existing app actions or local stored data to show rows. Verify:

- Table body scrolls inside the table container.
- Header remains fixed while vertically scrolling the table.
- `列设置` menu opens.
- Hiding a column removes it from the table.
- Refreshing the page keeps the hidden column hidden.
- The last visible column cannot be hidden.

- [ ] **Step 4: Verify records table behavior**

Open:

```text
http://localhost:5173/records/douyin
```

Verify the same fixed-header and column visibility behavior. Also check `http://localhost:5173/records/xhs` if data exists.

- [ ] **Step 5: Run production build**

Run:

```powershell
npm run build:frontend
```

Expected: build succeeds.

- [ ] **Step 6: Commit polish fixes**

If verification required fixes, run:

```powershell
git add -- frontend-react
git commit -m "完善表格重构交互细节"
```

If no fixes were required, skip this commit.

## Self-Review

- Spec coverage: Tailwind/shadcn foundation is covered by Task 1 and Task 2. Sticky table header, column definitions, local persistence, and fallback behavior are covered by Task 3 and Task 4. Crawl and records page integration with page/platform-specific keys is covered by Task 5. Browser and build verification are covered by Task 6.
- Placeholder scan: no `TBD`, `TODO`, or vague implementation-only placeholders are included.
- Type consistency: `columns`, `storageKey`, `visibleIds`, `visibleColumns`, `isColumnVisible`, and `setColumnVisible` are defined consistently across hook, table component, and page wiring.
