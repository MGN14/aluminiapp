import { useViewMode } from '@/contexts/ViewModeContext';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Eye, Settings2 } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export function ViewModeToggle() {
  const { viewMode, setViewMode, isAdvancedMode } = useViewMode();

  return (
    <div className="flex items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-muted/50 border border-border">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <Label htmlFor="view-mode" className="text-xs font-medium cursor-pointer">
              {isAdvancedMode ? 'Avanzado' : 'Simple'}
            </Label>
            <Switch
              id="view-mode"
              checked={isAdvancedMode}
              onCheckedChange={(checked) => setViewMode(checked ? 'advanced' : 'simple')}
              className="scale-75"
            />
            <Settings2 className="h-4 w-4 text-muted-foreground" />
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[250px]">
          <p className="text-xs">
            <strong>Modo Simple:</strong> Vista limpia con tipos operativos.
            <br />
            <strong>Modo Avanzado:</strong> Detalle contable (IVA débito/crédito).
          </p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
