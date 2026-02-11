import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Category, REPORT_GROUPS, ReportGroup } from '@/types/transaction';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Plus, Settings, Trash2, Loader2, ChevronUp, ChevronDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface Props {
  onUpdate?: () => void;
}

export default function CategoryManagement({ onUpdate }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(false);
  const [newName, setNewName] = useState('');
  const [newReportGroup, setNewReportGroup] = useState<ReportGroup>('otros');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (open) fetchCategories();
  }, [open]);

  const fetchCategories = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('categories')
      .select('*')
      .order('sort_order');
    setCategories((data as Category[]) || []);
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!newName.trim() || !user) return;
    setAdding(true);
    
    const maxOrder = categories.length > 0 ? Math.max(...categories.map(c => c.sort_order)) : 0;
    
    const { error } = await supabase
      .from('categories')
      .insert({ user_id: user.id, name: newName.trim(), sort_order: maxOrder + 1, report_group: newReportGroup });

    if (error) {
      toast({ title: 'Error', description: 'No se pudo crear la categoría.', variant: 'destructive' });
    } else {
      setNewName('');
      setNewReportGroup('otros');
      fetchCategories();
      onUpdate?.();
    }
    setAdding(false);
  };

  const handleToggleActive = async (id: string, active: boolean) => {
    await supabase.from('categories').update({ active }).eq('id', id);
    fetchCategories();
    onUpdate?.();
  };

  const handleReportGroupChange = async (id: string, report_group: string) => {
    await supabase.from('categories').update({ report_group }).eq('id', id);
    fetchCategories();
    onUpdate?.();
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= categories.length) return;

    await Promise.all([
      supabase.from('categories').update({ sort_order: newIndex }).eq('id', categories[index].id),
      supabase.from('categories').update({ sort_order: index }).eq('id', categories[newIndex].id),
    ]);

    fetchCategories();
    onUpdate?.();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) {
      toast({ title: 'No se puede eliminar', description: 'Esta categoría está en uso.', variant: 'destructive' });
    } else {
      fetchCategories();
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Administrar Categorías</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Nombre"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              className="flex-1"
            />
            <Select value={newReportGroup} onValueChange={(v) => setNewReportGroup(v as ReportGroup)}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REPORT_GROUPS.map((g) => (
                  <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={handleAdd} disabled={adding || !newName.trim()}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            </Button>
          </div>

          {loading ? (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {categories.map((cat, index) => (
                <div key={cat.id} className="flex items-center justify-between p-2 rounded-lg border border-border gap-2">
                  <span className={`text-sm flex-shrink-0 ${!cat.active ? 'text-muted-foreground line-through' : ''}`}>
                    {cat.name}
                  </span>
                  <div className="flex items-center gap-1">
                    <Select
                      value={cat.report_group || 'otros'}
                      onValueChange={(v) => handleReportGroupChange(cat.id, v)}
                    >
                      <SelectTrigger className="h-7 text-xs w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REPORT_GROUPS.map((g) => (
                          <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="sm" onClick={() => handleMove(index, 'up')} disabled={index === 0}>
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => handleMove(index, 'down')} disabled={index === categories.length - 1}>
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Switch checked={cat.active} onCheckedChange={(checked) => handleToggleActive(cat.id, checked)} />
                    <Button variant="ghost" size="sm" onClick={() => handleDelete(cat.id)} className="text-destructive hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              {categories.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-4">
                  No hay categorías creadas
                </p>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
