import { forwardRef } from 'react';
import { Loader2, Check, AlertCircle } from 'lucide-react';
import { SaveStatus } from '@/hooks/useTransactionEdit';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface SaveStatusIndicatorProps {
  status: SaveStatus;
  errorMessage?: string | null;
}

const SaveStatusIndicator = forwardRef<HTMLDivElement, SaveStatusIndicatorProps>(
  function SaveStatusIndicator({ status, errorMessage }, ref) {
    if (status === 'idle') {
      return <div ref={ref} />;
    }

    if (status === 'saving') {
      return (
        <div ref={ref} role="status" className="flex items-center gap-1 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span className="text-xs">Guardando...</span>
        </div>
      );
    }

    if (status === 'saved') {
      return (
        <div ref={ref} role="status" className="flex items-center gap-1 text-success animate-in fade-in duration-200">
          <Check className="h-3 w-3" />
          <span className="text-xs">Guardado</span>
        </div>
      );
    }

    if (status === 'error') {
      return (
        <Tooltip>
          <TooltipTrigger asChild>
            <div ref={ref} role="alert" tabIndex={0} className="flex items-center gap-1 text-destructive cursor-help">
              <AlertCircle className="h-3 w-3" />
              <span className="text-xs">No se guardó</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="text-xs">{errorMessage || 'Error al guardar'}</p>
          </TooltipContent>
        </Tooltip>
      );
    }

    return <div ref={ref} />;
  }
);

export default SaveStatusIndicator;
