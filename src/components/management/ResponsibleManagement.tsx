import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Responsible } from '@/types/transaction';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { Plus, Settings, Trash2, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Props {
  onUpdate?: () => void;
}

export default function ResponsibleManagement({ onUpdate }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [responsibles, setResponsibles] = useState<Responsible[]>([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (open) fetchResponsibles();
  }, [open]);

  const fetchResponsibles = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('responsibles')
      .select('*')
      .order('name');
    setResponsibles((data as Responsible[]) || []);
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!newName.trim() || !user) return;
    setAdding(true);
    
    const { error } = await supabase
      .from('responsibles')
      .insert({ user_id: user.id, name: newName.trim() });

    if (error) {
      toast({ title: 'Error', description: 'No se pudo crear el responsable.', variant: 'destructive' });
    } else {
      setNewName('');
      fetchResponsibles();
      onUpdate?.();
    }
    setAdding(false);
  };

  const handleToggleActive = async (id: string, active: boolean) => {
    await supabase.from('responsibles').update({ active }).eq('id', id);
    fetchResponsibles();
    onUpdate?.();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('responsibles').delete().eq('id', id);
    if (error) {
      toast({ title: 'No se puede eliminar', description: 'Este responsable está en uso.', variant: 'destructive' });
    } else {
      fetchResponsibles();
      onUpdate?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-xs">
          <Settings className="h-3 w-3 mr-1" />
          Gestionar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Administrar Responsables</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Nombre del responsable"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            />
            <Button onClick={handleAdd} disabled={adding || !newName.trim()}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-2 max-h-[300px] overflow-y-auto">
              {responsibles.map((r) => (
                <div key={r.id} className="flex items-center justify-between p-2 rounded-lg border border-border">
                  <span className={`text-sm ${!r.active ? 'text-muted-foreground line-through' : ''}`}>
                    {r.name}
                  </span>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={r.active}
                      onCheckedChange={(checked) => handleToggleActive(r.id, checked)}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(r.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              {responsibles.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-4">
                  No hay responsables creados
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
