import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Settings2, ChevronUp, ChevronDown, Pin, RotateCcw } from 'lucide-react';
import { useDashboardCustomization } from '@/hooks/useDashboardCustomization';
import { useState } from 'react';

interface Props {
  customization: ReturnType<typeof useDashboardCustomization>;
}

export default function DashboardCustomizeModal({ customization }: Props) {
  const { modules, toggleVisibility, moveUp, moveDown, resetDefaults, togglePin } = customization;
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 text-xs">
          <Settings2 className="h-3.5 w-3.5" />
          Personalizar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">Personalizar dashboard</DialogTitle>
        </DialogHeader>
        <div className="space-y-1 mt-2">
          {modules.map((m, idx) => (
            <div key={m.id} className="flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors">
              <Switch
                checked={m.visible}
                onCheckedChange={() => toggleVisibility(m.id)}
                className="shrink-0"
              />
              <span className="text-sm flex-1 text-foreground">{m.label}</span>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => togglePin(m.id)}
                  className={`p-1 rounded hover:bg-muted ${m.pinned ? 'text-primary' : 'text-muted-foreground/40'}`}
                  title={m.pinned ? 'Desfijar' : 'Fijar'}
                >
                  <Pin className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => moveUp(m.id)}
                  disabled={idx === 0}
                  className="p-1 rounded hover:bg-muted disabled:opacity-20 text-muted-foreground"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => moveDown(m.id)}
                  disabled={idx === modules.length - 1}
                  className="p-1 rounded hover:bg-muted disabled:opacity-20 text-muted-foreground"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-between items-center mt-4 pt-3 border-t border-border">
          <Button variant="ghost" size="sm" className="text-xs gap-1.5 text-muted-foreground" onClick={resetDefaults}>
            <RotateCcw className="h-3 w-3" /> Restablecer
          </Button>
          <Button size="sm" onClick={() => setOpen(false)}>Listo</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
