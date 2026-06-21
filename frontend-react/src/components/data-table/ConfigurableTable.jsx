import { Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu.jsx';
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="secondary" size="sm" aria-label="配置表格列">
              <Settings2 className="mr-1.5 h-4 w-4" />
              列设置
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {columns.map(column => {
              const checked = isColumnVisible(column.id);
              const disableHide = column.alwaysVisible || (checked && visibleIds.length <= 1);
              return (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={checked}
                  disabled={disableHide}
                  onSelect={event => event.preventDefault()}
                  onCheckedChange={checkedValue => setColumnVisible(column.id, checkedValue)}
                >
                  {column.settingsLabel || column.label}
                </DropdownMenuCheckboxItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="tableScroll">
        <Table>
          <TableHeader>
            <TableRow>
              {visibleColumns.map(column => (
                <TableHead key={column.id} className={column.headerClassName || column.className}>
                  {column.header || column.label}
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
