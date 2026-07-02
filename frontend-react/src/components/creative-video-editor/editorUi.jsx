import { cn } from '@/lib/utils.js';

// Shared /editor panel primitives. Descendant styling (button/label/input/select/
// textarea inside a panel) is expressed with Tailwind arbitrary variants so it maps
// 1:1 to the old `.creative-video-editor-panel button { }` etc. without classing every child.

const FIELD = '[&_:is(input,select,textarea)]:w-full [&_:is(input,select,textarea)]:rounded-md [&_:is(input,select,textarea)]:border [&_:is(input,select,textarea)]:border-[#d1d5db] [&_:is(input,select,textarea)]:bg-white [&_:is(input,select,textarea)]:p-2 [&_:is(input,select,textarea)]:text-[#111827] [&_[type=checkbox]]:w-auto [&_[type=checkbox]]:justify-self-start';
const LABEL = '[&_label]:mt-2 [&_label]:grid [&_label]:gap-[5px] [&_label]:text-xs [&_label]:text-[#4b5563]';

const PANEL = cn(
  'grid min-w-0 gap-2 rounded-lg border border-[#e5e7eb] bg-[#fbfdff] p-2.5',
  '[&_h3]:m-0 [&_h3]:text-sm',
  '[&_button]:cursor-pointer [&_button]:rounded-md [&_button]:border-0 [&_button]:bg-[#111827] [&_button]:px-3 [&_button]:py-2 [&_button]:font-bold [&_button]:text-white',
  '[&_button:disabled]:cursor-not-allowed [&_button:disabled]:opacity-[.55]',
  LABEL,
  FIELD,
);

// Section = the bordered card + form-field styling, without the panel grid/dark buttons.
const SECTION = cn('rounded-lg border border-[#e5e7eb] bg-[#fbfdff] p-2.5', LABEL, FIELD);

export function EditorPanel({ className, children, ...props }) {
  return <section className={cn(PANEL, className)} {...props}>{children}</section>;
}

export function EditorSection({ className, children, ...props }) {
  return <section className={cn(SECTION, className)} {...props}>{children}</section>;
}

export function EditorPanelHeader({ className, children, ...props }) {
  return (
    <div className={cn('flex items-center justify-between gap-2 max-[720px]:flex-col max-[720px]:items-start', className)} {...props}>
      {children}
    </div>
  );
}

export function EditorInlineActions({ className, children, ...props }) {
  return <div className={cn('flex flex-wrap justify-end gap-1.5', className)} {...props}>{children}</div>;
}
