import { useState, useEffect, useMemo, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import AppLayout from '@/components/layout/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, Trash2, TrendingUp, TrendingDown, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { useModuleContext } from '@/hooks/useModuleContext';

const CATEGORIES = [
  'Ventas en efectivo',
  'Compra de mercancía',
  'Gastos operativos',
  'Nómina',
  'Servicios',
  'Transporte',
  'Otros',
];

interface CashMovement {
  id: string;
  date: string;
  type: string;
  amount: number;
  description: string;
  category: string | null;
  notes: string | null;
  responsible_id: string | null;
  created_at: string;
}

interface ResponsibleOption {
  id: string;
  name: string;
}

const NO_RESPONSIBLE = '__none__';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(value);
}

export default function CashMovements() {
  const { isGerencial } = useModuleContext();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  // Form state
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [type, setType] = useState<'ingreso' | 'egreso'>('ingreso');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [notes, setNotes] = useState('');
  const [responsibleId, setResponsibleId] = useState<string>(NO_RESPONSIBLE);

  const { data: responsibles = [] } = useQuery<ResponsibleOption[]>({
    queryKey: ['responsibles-cash-movements', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('responsibles')
        .select('id, name')
        .eq('user_id', user!.id)
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
  });

  const fetchMovements = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('cash_movements')
        .select('*')
        .order('date', { ascending: false })
        .order('created_at', { ascending: false });
      if (error) throw error;
      setMovements((data as CashMovement[]) || []);
    } catch (e) {
      console.error('Error fetching cash movements:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMovements(); }, [fetchMovements]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !amount) {
      toast({ title: 'Campos requeridos', description: 'Completa fecha y monto.', variant: 'destructive' });
      return;
    }
    if (responsibleId === NO_RESPONSIBLE) {
      toast({ title: 'Falta beneficiario', description: 'Seleccioná un beneficiario. Si no existe, creálo desde Conciliación bancaria.', variant: 'destructive' });
      return;
    }
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast({ title: 'Monto inválido', description: 'El monto debe ser mayor a 0.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No autenticado');

      const beneficiaryName = responsibles.find(r => r.id === responsibleId)?.name ?? null;

      const { error } = await supabase.from('cash_movements').insert({
        user_id: user.id,
        date: format(date, 'yyyy-MM-dd'),
        type,
        amount: numAmount,
        description: beneficiaryName,
        category: category || null,
        notes: notes.trim() || null,
        responsible_id: responsibleId,
      });
      if (error) throw error;

      toast({ title: 'Movimiento registrado' });
      setAmount('');
      setCategory('');
      setNotes('');
      setResponsibleId(NO_RESPONSIBLE);
      fetchMovements();
      queryClient.invalidateQueries({ queryKey: ['operative-receivables'] });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const { error } = await supabase.from('cash_movements').delete().eq('id', id);
      if (error) throw error;
      setMovements(prev => prev.filter(m => m.id !== id));
      toast({ title: 'Movimiento eliminado' });
      queryClient.invalidateQueries({ queryKey: ['operative-receivables'] });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const responsibleNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of responsibles) map.set(r.id, r.name);
    return map;
  }, [responsibles]);

  const totals = useMemo(() => {
    const ingresos = movements.filter(m => m.type === 'ingreso').reduce((s, m) => s + m.amount, 0);
    const egresos = movements.filter(m => m.type === 'egreso').reduce((s, m) => s + m.amount, 0);
    return { ingresos, egresos, neto: ingresos - egresos };
  }, [movements]);

  // Guard de modo: los movimientos en efectivo son data sensible del modo gerencial.
  // Si el admin vuelve a DIAN, lo sacamos de aquí para evitar mezcla de contextos.
  // (Los hooks se declaran arriba para respetar Rules of Hooks.)
  if (!isGerencial) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <AppLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Movimientos en Efectivo</h1>
          <p className="text-muted-foreground text-sm mt-1">Registra ingresos y egresos de caja que no pasan por el banco.</p>
        </div>

        {/* Totals */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-success/10 flex items-center justify-center"><TrendingUp className="h-5 w-5 text-success" /></div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Ingresos</p>
                <p className="text-xl font-bold text-success">{formatCurrency(totals.ingresos)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5 flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-destructive/10 flex items-center justify-center"><TrendingDown className="h-5 w-5 text-destructive" /></div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Egresos</p>
                <p className="text-xl font-bold text-destructive">{formatCurrency(totals.egresos)}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-5 flex items-center gap-4">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${totals.neto >= 0 ? 'bg-success/10' : 'bg-destructive/10'}`}>
                {totals.neto >= 0 ? <TrendingUp className="h-5 w-5 text-success" /> : <TrendingDown className="h-5 w-5 text-destructive" />}
              </div>
              <div>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">Neto</p>
                <p className={`text-xl font-bold ${totals.neto >= 0 ? 'text-success' : 'text-destructive'}`}>{formatCurrency(totals.neto)}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Form */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Registrar movimiento</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {/* Fecha */}
              <div className="space-y-1.5">
                <Label>Fecha</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}>
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {date ? format(date, 'PPP', { locale: es }) : 'Seleccionar'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={date} onSelect={setDate} initialFocus className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Tipo */}
              <div className="space-y-1.5">
                <Label>Tipo</Label>
                <div className="flex gap-2">
                  <Button type="button" variant={type === 'ingreso' ? 'default' : 'outline'} className={cn("flex-1", type === 'ingreso' && 'bg-success hover:bg-success/90 text-success-foreground')} onClick={() => setType('ingreso')}>
                    Ingreso
                  </Button>
                  <Button type="button" variant={type === 'egreso' ? 'default' : 'outline'} className={cn("flex-1", type === 'egreso' && 'bg-destructive hover:bg-destructive/90 text-destructive-foreground')} onClick={() => setType('egreso')}>
                    Egreso
                  </Button>
                </div>
              </div>

              {/* Monto */}
              <div className="space-y-1.5">
                <Label>Monto</Label>
                <Input type="number" min="0" step="1" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)} />
              </div>

              {/* Beneficiario (vinculado a responsibles de Conciliación bancaria) */}
              <div className="space-y-1.5">
                <Label>Beneficiario</Label>
                <Select value={responsibleId} onValueChange={setResponsibleId}>
                  <SelectTrigger>
                    <SelectValue placeholder={responsibles.length === 0 ? 'Crealo en Conciliación bancaria primero' : 'Seleccionar beneficiario'} />
                  </SelectTrigger>
                  <SelectContent>
                    {responsibles.length === 0 ? (
                      <div className="text-xs text-muted-foreground p-2">
                        No tenés beneficiarios. Creá uno desde Conciliación bancaria.
                      </div>
                    ) : (
                      responsibles.map(r => (
                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
                {type === 'ingreso' && (
                  <p className="text-[10px] text-muted-foreground">
                    Este ingreso descuenta automáticamente la deuda del beneficiario en Cartera Operativa.
                  </p>
                )}
              </div>

              {/* Categoría */}
              <div className="space-y-1.5">
                <Label>Categoría</Label>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue placeholder="Seleccionar" /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Notas */}
              <div className="space-y-1.5">
                <Label>Notas (opcional)</Label>
                <Textarea placeholder="Notas adicionales..." value={notes} onChange={e => setNotes(e.target.value)} rows={1} />
              </div>

              <div className="sm:col-span-2 lg:col-span-3 flex justify-end">
                <Button type="submit" disabled={saving} className="gap-2">
                  <Plus className="h-4 w-4" />
                  {saving ? 'Guardando...' : 'Registrar movimiento'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {/* Table */}
        <Card className="border-0 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Movimientos registrados</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-sm text-muted-foreground">Cargando...</p>
            ) : movements.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay movimientos registrados aún.</p>
            ) : (
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Tipo</TableHead>
                      <TableHead>Monto</TableHead>
                      <TableHead>Beneficiario</TableHead>
                      <TableHead>Categoría</TableHead>
                      <TableHead>Notas</TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.map(m => {
                      const beneficiarioName = m.responsible_id
                        ? responsibleNameById.get(m.responsible_id) ?? null
                        : null;
                      const legacyDescription = !m.responsible_id ? m.description : null;
                      return (
                      <TableRow key={m.id}>
                        <TableCell className="whitespace-nowrap">{format(new Date(m.date + 'T00:00:00'), 'dd MMM yyyy', { locale: es })}</TableCell>
                        <TableCell>
                          <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", m.type === 'ingreso' ? 'bg-success/10 text-success' : 'bg-destructive/10 text-destructive')}>
                            {m.type === 'ingreso' ? 'Ingreso' : 'Egreso'}
                          </span>
                        </TableCell>
                        <TableCell className={cn("font-medium", m.type === 'ingreso' ? 'text-success' : 'text-destructive')}>
                          {formatCurrency(m.amount)}
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate">
                          {beneficiarioName ? (
                            <span className="font-medium">{beneficiarioName}</span>
                          ) : legacyDescription ? (
                            <span className="text-muted-foreground italic text-sm" title="Descripción legacy (sin beneficiario vinculado)">
                              {legacyDescription}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">{m.category || '—'}</TableCell>
                        <TableCell className="text-muted-foreground text-sm max-w-[150px] truncate">{m.notes || '—'}</TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => handleDelete(m.id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
