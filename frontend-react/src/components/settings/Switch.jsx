import { cn } from '@/lib/utils.js';

// Controlled toggle. Track/thumb are driven off `checked` (React already owns it),
// so no peer/sibling CSS is needed; a transparent real checkbox keeps it accessible.
export function Switch({ checked, onChange, disabled, small = false }) {
  return (
    <span
      className={cn(
        'relative inline-flex flex-none rounded-full transition-colors duration-[180ms] has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[#25f4ee]',
        small ? 'h-5 w-[34px]' : 'h-6 w-[42px]',
        checked ? 'bg-[#111827]' : 'bg-[#c8ced8]',
      )}
    >
      <input
        type="checkbox"
        className="absolute inset-0 m-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute left-[3px] top-[3px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,.24)] transition-transform duration-[180ms]',
          small ? 'size-[14px]' : 'size-[18px]',
          checked && (small ? 'translate-x-[14px]' : 'translate-x-[18px]'),
        )}
      />
    </span>
  );
}
