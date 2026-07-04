import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UserRound, CheckCircle2, AlertTriangle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { usePayrollEmployees } from '@/hooks/usePayrollEmployees';
import {
  computeEmployeePrestaciones,
  EVENT_TIPO_LABEL,
  TIPO_CONTRATO_LABEL,
  type EmployeeRow,
} from '@/lib/payrollEmployee';

interface Props {
  open: boolean;
  onClose: () => void;
  employee: EmployeeRow | null; // null = nuevo
}

const hoy = () => new Date().toISOString().split('T')[0];
const fmtCOP = (n: number) => `$${Math.round(n).toLocaleString('es-CO')}`;
const fmtFecha = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

export default function EmployeeModal({ open, onClose, employee }: Props) {
  const { events, params, saveEmployee, addEvent, removeEvent } = usePayrollEmployees();
  const isEdit = !!employee;

  const [nombre, setNombre] = useState('');
  const [documento, setDocumento] = useState('');
  const [cargo, setCargo] = useState('');
  const [salario, setSalario] = useState<number | ''>('');
  const [fechaIngreso, setFechaIngreso] = useState(hoy());
  const [fechaRetiro, setFechaRetiro] = useState('');
  const [tipoContrato, setTipoContrato] = useState('indefinido');
  const [arlClase, setArlClase] = useState(3);
  const [auxTransporte, setAuxTransporte] = useState(true);
  const [activo, setActivo] = useState(true);

  // Novedad rápida
  const [evTipo, setEvTipo] = useState('dotacion');
  const [evFecha, setEvFecha] = useState(hoy());
  const [evDias, setEvDias] = useState<number | ''>('');
  const [evMonto, setEvMonto] = useState<number | ''>('');
  const [evNotas, setEvNotas] = useState('');

  useEffect(() => {
    if (!open) return;
    setNombre(employee?.nombre ?? '');
    setDocumento(employee?.documento ?? '');
    setCargo(employee?.cargo ?? '');
    setSalario(employee?.salario_base ?? '');
    setFechaIngreso(employee?.fecha_ingreso ?? hoy());
    setFechaRetiro(employee?.fecha_retiro ?? '');
    setTipoContrato(employee?.tipo_contrato ?? 'indefinido');
    setArlClase(employee?.arl_clase ?? 3);
    setAuxTransporte(employee?.auxilio_transporte ?? true);
    setActivo(employee?.activo ?? true);
    setEvTipo('dotacion'); setEvFecha(hoy()); setEvDias(''); setEvMonto(''); setEvNotas('');
  }, [open, employee]);

  const prest = employee
    ? computeEmployeePrestaciones(employee, events, params)
    : null;
  const empEvents = employee ? events.filter(e => e.employee_id === employee.id) : [];

  const handleSave = async () => {
    if (!nombre.trim() || salario === '' || !fechaIngreso) return;
    await saveEmployee.mutateAsync({
      ...(employee ? { id: employee.id } : {}),
      nombre: nombre.trim(),
      documento: documento.trim() || null,
      cargo: cargo.trim() || null,
      salario_base: Number(salario),
      fecha_ingreso: fechaIngreso,
      fecha_retiro: fechaRetiro || null,
      tipo_contrato: tipoContrato,
      arl_clase: arlClase,
      auxilio_transporte: auxTransporte,
      activo,
    } as Partial<EmployeeRow> & { id?: string });
    onClose();
  };

  const handleAddEvent = async () => {
    if (!employee) return;
    await addEvent.mutateAsync({
      employee_id: employee.id,
      tipo: evTipo,
      fecha: evFecha,
      dias: evDias === '' ? null : Number(evDias),
      monto: evMonto === '' ? null : Number(evMonto),
      notas: evNotas.trim() || null,
    });
    setEvDias(''); setEvMonto(''); setEvNotas('');
  };

  const fichaForm = (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-sm">Nombre *</Label>
          <Input value={nombre} onChange={e => setNombre(e.target.value)} placeholder="Nombre completo" />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Documento (CC)</Label>
          <Input value={documento} onChange={e => setDocumento(e.target.value)} className="font-mono" />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Cargo</Label>
          <Input value={cargo} onChange={e => setCargo(e.target.value)} placeholder="Ej: Operario, Vendedor" />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Salario base mensual *</Label>
          <Input type="number" min={0} value={salario} onChange={e => setSalario(e.target.value === '' ? '' : +e.target.value)} className="font-mono" />
          {typeof salario === 'number' && salario > 0 && (
            <p className="text-[10px] text-muted-foreground">
              {(salario / params.smmlv).toFixed(2)} SMMLV
              {salario <= 2 * params.smmlv ? ' · derecho a auxilio y dotación' : ' · sin auxilio ni dotación (>2 SMMLV)'}
            </p>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Fecha de ingreso *</Label>
          <Input type="date" value={fechaIngreso} onChange={e => setFechaIngreso(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Fecha de retiro</Label>
          <Input type="date" value={fechaRetiro} onChange={e => setFechaRetiro(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Tipo de contrato</Label>
          <Select value={tipoContrato} onValueChange={setTipoContrato}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(TIPO_CONTRATO_LABEL).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-sm">Clase de riesgo ARL</Label>
          <Select value={String(arlClase)} onValueChange={v => setArlClase(Number(v))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map(c => (
                <SelectItem key={c} value={String(c)}>
                  Clase {['I — mínimo (oficina)', 'II — bajo', 'III — medio (manufactura)', 'IV — alto', 'V — máximo'][c - 1]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex items-center gap-6 pt-1">
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={auxTransporte} onCheckedChange={setAuxTransporte} />
          Auxilio de transporte
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Switch checked={activo} onCheckedChange={setActivo} />
          Activo
        </label>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserRound className="h-5 w-5 text-primary" />
            {isEdit ? nombre || employee!.nombre : 'Nuevo empleado'}
            {isEdit && employee!.cargo && (
              <span className="text-sm font-normal text-muted-foreground">· {employee!.cargo}</span>
            )}
          </DialogTitle>
        </DialogHeader>

        {!isEdit ? (
          <div className="space-y-4">
            {fichaForm}
            <Button className="w-full" onClick={handleSave} disabled={saveEmployee.isPending || !nombre.trim() || salario === ''}>
              {saveEmployee.isPending ? 'Guardando…' : 'Crear empleado'}
            </Button>
          </div>
        ) : (
          <Tabs defaultValue="prestaciones">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="prestaciones">Prestaciones</TabsTrigger>
              <TabsTrigger value="novedades">Novedades{empEvents.length ? ` (${empEvents.length})` : ''}</TabsTrigger>
              <TabsTrigger value="ficha">Ficha</TabsTrigger>
            </TabsList>

            {/* ── PRESTACIONES: el reporte por empleado ── */}
            <TabsContent value="prestaciones" className="space-y-3 pt-3">
              {prest && (
                <>
                  {/* Checklist "¿estoy al día con este empleado?" */}
                  <div className="space-y-1.5">
                    {prest.dotacionAplica && (
                      <div className={cn('flex items-center gap-2 text-xs rounded-lg border px-3 py-2',
                        prest.dotacionPendientes.length ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/20' : 'border-success/25 bg-success/5')}>
                        {prest.dotacionPendientes.length
                          ? <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                          : <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />}
                        <span>
                          <strong>Dotación</strong>: {prest.dotacionEntregasAnio}/3 entregas este año.
                          {prest.dotacionPendientes.length > 0 && (
                            <> Vencida{prest.dotacionPendientes.length > 1 ? 's' : ''}: {prest.dotacionPendientes.map(fmtFecha).join(', ')} — registrá la entrega en Novedades.</>
                          )}
                        </span>
                      </div>
                    )}
                    <div className={cn('flex items-center gap-2 text-xs rounded-lg border px-3 py-2',
                      prest.vacacionesDiasPendientes > 15 ? 'border-amber-300 bg-amber-50 dark:bg-amber-950/20' : 'border-success/25 bg-success/5')}>
                      {prest.vacacionesDiasPendientes > 15
                        ? <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                        : <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />}
                      <span>
                        <strong>Vacaciones</strong>: {prest.vacacionesDiasPendientes} días pendientes
                        ({prest.vacacionesDiasGanados} ganados − {prest.vacacionesDiasTomados} tomados).
                        {prest.vacacionesDiasPendientes > 15 && ' Más de un período acumulado — programalas (la ley no deja acumular más de 2).'}
                      </span>
                    </div>
                    <div className={cn('flex items-center gap-2 text-xs rounded-lg border px-3 py-2',
                      prest.primaSemestrePagada ? 'border-success/25 bg-success/5' : 'border-border bg-muted/30')}>
                      {prest.primaSemestrePagada
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-success shrink-0" />
                        : <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                      <span>
                        <strong>Prima del semestre</strong>: {prest.primaSemestrePagada ? 'pagada' : 'aún sin registrar'}
                        {' '}(vence 30 jun / 20 dic). Acumulada: {fmtCOP(prest.primaAcum)}.
                      </span>
                    </div>
                  </div>

                  {/* Acumulados del año */}
                  <div className="rounded-xl border border-border bg-muted/20 px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 mb-2">
                      Acumulado {new Date().getFullYear()} · base prestacional {fmtCOP(prest.basePrestacional)}
                      {prest.tieneAuxTransporte ? ' (salario + auxilio)' : ' (sin auxilio)'}
                      {' '}· {prest.diasAnio} días
                    </p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                      <div>
                        <p className="text-[10px] text-muted-foreground">Cesantías</p>
                        <p className="text-sm font-bold font-mono">{fmtCOP(prest.cesantiasAcum)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">Int. cesantías</p>
                        <p className="text-sm font-bold font-mono">{fmtCOP(prest.interesesCesantiasAcum)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">Prima (semestre)</p>
                        <p className="text-sm font-bold font-mono">{fmtCOP(prest.primaAcum)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">Vacaciones ($)</p>
                        <p className="text-sm font-bold font-mono">{fmtCOP(prest.vacacionesProvisionAcum)}</p>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-2">
                      Pasivo laboral acumulado de este empleado: <strong>
                        {fmtCOP(prest.cesantiasAcum + prest.interesesCesantiasAcum + prest.primaAcum + prest.vacacionesProvisionAcum)}
                      </strong> — lo que le deberías si se retirara hoy.
                    </p>
                  </div>

                  <p className="text-[10px] text-muted-foreground">
                    Antigüedad: {Math.floor(prest.antiguedadDias / 360)} año{Math.floor(prest.antiguedadDias / 360) !== 1 ? 's' : ''} y {prest.antiguedadDias % 360} días
                    (desde {fmtFecha(employee!.fecha_ingreso)}) · Contrato {TIPO_CONTRATO_LABEL[employee!.tipo_contrato] ?? employee!.tipo_contrato} · ARL clase {employee!.arl_clase}.
                    Cálculos base 360 — verificalos con tu contador para liquidaciones definitivas.
                  </p>
                </>
              )}
            </TabsContent>

            {/* ── NOVEDADES ── */}
            <TabsContent value="novedades" className="space-y-3 pt-3">
              <div className="rounded-xl border border-border px-3 py-3 space-y-2">
                <Label className="text-xs font-semibold text-muted-foreground">Registrar novedad</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={evTipo} onValueChange={setEvTipo}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(EVENT_TIPO_LABEL).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input type="date" value={evFecha} max={hoy()} onChange={e => setEvFecha(e.target.value)} className="h-8 text-xs" />
                  {(evTipo === 'vacaciones' || evTipo === 'incapacidad' || evTipo === 'licencia') && (
                    <Input type="number" min={1} placeholder="Días" value={evDias} onChange={e => setEvDias(e.target.value === '' ? '' : +e.target.value)} className="h-8 text-xs font-mono" />
                  )}
                  {(evTipo === 'dotacion' || evTipo.includes('pagad') || evTipo.includes('consignad') || evTipo === 'aumento_salario' || evTipo === 'otro') && (
                    <Input type="number" min={0} placeholder="Monto $" value={evMonto} onChange={e => setEvMonto(e.target.value === '' ? '' : +e.target.value)} className="h-8 text-xs font-mono" />
                  )}
                  <Input placeholder="Notas" value={evNotas} onChange={e => setEvNotas(e.target.value)} className="h-8 text-xs col-span-2" />
                </div>
                <Button size="sm" className="w-full h-8" onClick={handleAddEvent} disabled={addEvent.isPending}>
                  Registrar
                </Button>
              </div>

              <div className="divide-y divide-border rounded-xl border border-border overflow-hidden">
                {empEvents.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    Sin novedades. Registrá acá dotaciones, vacaciones, pagos de prima/cesantías…
                  </p>
                )}
                {empEvents.map(ev => (
                  <div key={ev.id} className="flex items-center gap-2 px-3 py-2 text-xs">
                    <span className="font-medium shrink-0">{EVENT_TIPO_LABEL[ev.tipo] ?? ev.tipo}</span>
                    <span className="text-muted-foreground">{fmtFecha(ev.fecha)}</span>
                    {ev.dias != null && <span className="font-mono">{ev.dias}d</span>}
                    {ev.monto != null && <span className="font-mono">{fmtCOP(Number(ev.monto))}</span>}
                    <span className="text-muted-foreground truncate flex-1">{ev.notas}</span>
                    <button
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => removeEvent.mutate(ev.id)}
                      aria-label="Eliminar novedad"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </TabsContent>

            {/* ── FICHA ── */}
            <TabsContent value="ficha" className="space-y-4 pt-3">
              {fichaForm}
              <Button className="w-full" onClick={handleSave} disabled={saveEmployee.isPending || !nombre.trim() || salario === ''}>
                {saveEmployee.isPending ? 'Guardando…' : 'Guardar cambios'}
              </Button>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
