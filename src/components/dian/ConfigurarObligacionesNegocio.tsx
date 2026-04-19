import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  useBusinessObligations,
  BusinessObligation,
  BusinessObligationTipo,
  TIPO_LABELS,
} from '@/hooks/useBusinessObligations';
import { Plus, Trash2, Edit2, X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
}

const TIPOS: BusinessObligationTipo[] = [
  'arriendo', 'nomina', 'pila', 'servicios', 'parafiscales', 'cesantias', 'otro',
];

function formatCOP(n: number | null | undefined): string {
  if (!n) return '';
  return n.toLocaleString('es-CO');
}

function parseCOP(str: string): number | null {
  if (!str) return null;
  const cleaned = str.replace(/[^0-9]/g, '');
  const n = parseInt(cleaned);
  return isNaN(n) ? null : n;
}

export default function ConfigurarObligacionesNegocio({ open, onClose }: Props) {
  const { obligations, createObligation, updateObligation, deleteObligation } = useBusinessObligations();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<BusinessObligationTipo>('arriendo');
  const [diaMes, setDiaMes] = useState('5');
  const [monto, setMonto] = useState('');
  const [activa, setActiva] = useState(true);
  const [notas, setNotas] = useState('');

  const resetForm = () => {
    setEditingId(null);
    setNombre('');
    setTipo('arriendo');
    setDiaMes('5');
    setMonto('');
    setActiva(true);
    setNotas('');
    setShowForm(false);
  };

  const startEdit = (ob: BusinessObligation) => {
    setEditingId(ob.id);
    setNombre(ob.nombre);
    setTipo(ob.tipo);
    setDiaMes(String(ob.dia_mes));
    setMonto(ob.monto_estimado ? formatCOP(ob.monto_estimado) : '');
    setActiva(ob.activa);
    setNotas(ob.notas || '');
    setShowForm(true);
  };

  const handleSave = async () => {
    const payload = {
      nombre: nombre.trim(),
      tipo,
      dia_mes: Math.max(1, Math.min(31, parseInt(diaMes) || 1)),
      monto_estimado: parseCOP(monto),
      activa,
      notas: notas.trim() || null,
    };
    if (!payload.nombre) return;

    if (editingId) {
      await updateObligation.mutateAsync({ id: editingId, ...payload });
    } else {
      await createObligation.mutateAsync(payload);
    }
    resetForm();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar esta obligación?')) return;
    await deleteObligation.mutateAsync(id);
    if (editingId === id) resetForm();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { resetForm(); onClose(); } }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Obligaciones del negocio</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Lista actual */}
          {obligations.length > 0 && !showForm && (
            <div className="space-y-2">
              {obligations.map(ob => (
                <div key={ob.id} className="flex items-center gap-3 p-3 border rounded-lg">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{ob.nombre}</p>
                      <Badge variant="outline" className="text-[10px]">{TIPO_LABELS[ob.tipo]}</Badge>
                      {!ob.activa && <Badge variant="secondary" className="text-[10px]">Inactiva</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Día {ob.dia_mes} de cada mes
                      {ob.monto_estimado ? ` · $${formatCOP(ob.monto_estimado)}` : ''}
                    </p>
                  </div>
                  <button onClick={() => startEdit(ob)} className="p-1.5 hover:bg-muted rounded" aria-label="Editar">
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleDelete(ob.id)} className="p-1.5 hover:bg-muted rounded text-red-500" aria-label="Eliminar">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {obligations.length === 0 && !showForm && (
            <div className="text-center py-8 text-sm text-muted-foreground">
              Aún no tenés obligaciones configuradas. Agregá pagos recurrentes como arriendo, nómina o servicios.
            </div>
          )}

          {/* Form */}
          {showForm ? (
            <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">
                  {editingId ? 'Editar obligación' : 'Nueva obligación'}
                </p>
                <button onClick={resetForm} className="p-1 hover:bg-muted rounded">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div>
                <Label className="text-xs">Nombre</Label>
                <Input
                  placeholder="Ej: Arriendo bodega principal"
                  value={nombre}
                  onChange={e => setNombre(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Tipo</Label>
                  <Select value={tipo} onValueChange={(v) => setTipo(v as BusinessObligationTipo)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TIPOS.map(t => (
                        <SelectItem key={t} value={t}>{TIPO_LABELS[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">Día del mes</Label>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={diaMes}
                    onChange={e => setDiaMes(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <Label className="text-xs">Monto estimado (COP) — opcional</Label>
                <Input
                  placeholder="Ej: 2.500.000"
                  value={monto}
                  onChange={e => {
                    const n = parseCOP(e.target.value);
                    setMonto(n ? formatCOP(n) : '');
                  }}
                />
              </div>

              <div>
                <Label className="text-xs">Notas (opcional)</Label>
                <Textarea
                  placeholder="Ej: Se paga a Inmobiliaria XYZ, cuenta 123-456"
                  value={notas}
                  onChange={e => setNotas(e.target.value)}
                  rows={2}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Switch checked={activa} onCheckedChange={setActiva} id="activa" />
                  <Label htmlFor="activa" className="text-xs cursor-pointer">Activa</Label>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={resetForm}>Cancelar</Button>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={!nombre.trim() || createObligation.isPending || updateObligation.isPending}
                  >
                    {editingId ? 'Actualizar' : 'Agregar'}
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setShowForm(true)} className="w-full">
              <Plus className="h-4 w-4 mr-2" />
              Agregar obligación
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
