import { Link, useLocation } from 'react-router-dom';
import { FileClock } from 'lucide-react';
import { Button } from '@/components/ui/button.jsx';

export function ApiCallLogLink({ workflowId, label = 'API 返回记录' }) {
  const location = useLocation();
  return (
    <Button asChild variant="outline" size="sm">
      <Link to={`/api-calls${workflowId ? `?workflow=${encodeURIComponent(workflowId)}` : ''}`}
        state={{ from: `${location.pathname}${location.search}` }}>
        <FileClock size={14} aria-hidden="true" />{label}
      </Link>
    </Button>
  );
}
