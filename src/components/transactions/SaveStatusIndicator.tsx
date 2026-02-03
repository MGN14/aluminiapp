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

export default function SaveStatusIndicator({ status, errorMessage }: SaveStatusIndicatorProps) {
  if (status === 'idle') {
    return null;
  }

  if (status === 'saving') {
    return (
      <div className="flex items-center gap-1 text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span className="text-[10px]">Guardando...</span>
      </div>
    );
  }

  if (status === 'saved') {
    return (
      <div className="flex items-center gap-1 text-success animate-in fade-in duration-200">
        <Check className="h-3 w-3" />
        <span className="text-[10px]">Guardado</span>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-1 text-destructive cursor-help">
            <AlertCircle className="h-3 w-3" />
            <span className="text-[10px]">Error</span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top">
          <p className="text-xs">{errorMessage || 'Error al guardar'}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return null;
}
