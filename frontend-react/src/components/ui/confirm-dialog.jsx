import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog.jsx';

// 全站统一的确认弹窗：替代 window.confirm 与手写 fixed 弹层，
// 由 Radix Dialog 提供焦点陷阱、ESC 关闭和无障碍语义。
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmText = '确认',
  cancelText = '取消',
  destructive = false,
  loading = false,
  onConfirm,
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={value => {
        if (loading) return;
        onOpenChange(value);
      }}
    >
      <DialogContent className="w-[min(480px,calc(100vw-32px))]" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" type="button" disabled={loading} onClick={() => onOpenChange(false)}>
            {cancelText}
          </Button>
          <Button variant={destructive ? 'destructive' : 'default'} type="button" disabled={loading} onClick={onConfirm}>
            {loading ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}
            <span>{confirmText}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
