import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AppLayout from '@/components/layout/AppLayout';
import EmployeesSection from '@/components/nomina/EmployeesSection';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  HardHat, Save, Loader2, CalendarClock, ChevronDown, ChevronUp, Trash2, Info, ArrowRight,
} from 'lucide-react';
import { usePayroll, type PayrollEntry } from '@/hooks/usePayroll';
import { usePermissions } from '@/hooks/usePermissions';
import {
  computePayroll, DEFAULT_PAYROLL_RATES, ARL_CLASES, type PayrollRates,
} from '@/lib/payroll';
import { MONTH_NAMES } from '@/types/transaction';

function fmt(n: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(n);
}

const now = new Date();
const YEARS = Array.from({ length: 4 }, (_, i) => now.getFullYear() - 2 + i);

/** Día de pago configurable, recordado por navegador (no amerita tabla). */
function usePersistedDay(key: string, fallback: number): [number, (n: number) => void] {
  const [val, setVal] = useState<number>(() => {
    const raw = Number(localStorage.getItem(key));
    return raw >= 1 && raw <= 31 ? raw : fallback;
  });
  return [val, (n: number) => {
    const clamped = Math.min(31, Math.max(1, n || fallback));
    localStorage.setItem(key, String(clamped));
    setVal(clamped);
  }];
}

function RateInput({ label, value, onChange, disabled, suffix = '%' }: {
  label: string; value: number; onChange: (n: number) => void; disabled?: boolean; suffix?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      <div className="flex items-center gap-1">
        <Input
          type="number"
          step="0.001"
          min="0"
          className="h-8 text-xs"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value) || 0)}
        />
        <span className="text-xs text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
}

function BreakdownRow({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className={`flex items-center justify-between text-sm ${bold ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{fmt(value)}</span>
    </div>
  );
}

export default function Nomina() {
  const { entries, isLoading, saveEntry, deleteEntry, syncObligations } = usePayroll();
  const { canEdit } = usePermissions();
  const editable = canEdit('nomina');

  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [salary, setSalary] = useState<number>(0);
  const [transport, setTransport] = useState<number>(0);
  const [employees, setEmployees] = useState<number | null>(null);
  const [rates, setRates] = useState<PayrollRates>({ ...DEFAULT_PAYROLL_RATES });
  const [showRates, setShowRates] = useState(false);
  const [diaPagoNomina, setDiaPagoNomina] = usePersistedDay('nomina_dia_pago', 30);
  const [diaPagoPila, setDiaPagoPila] = usePersistedDay('nomina_dia_pila', 10);

  // Al elegir un periodo que ya tiene registro, precargar sus valores.
  const existingForPeriod = useMemo(
    () => entries.find((e) => e.year === year && e.month === month) ?? null,
    [entries, year, month],
  );
  const loadPeriod = (y: number, m: number) => {
    setYear(y);
    setMonth(m);
    const found = entries.find((e) => e.year === y && e.month === m);
    if (found) {
      setSalary(found.salary_total);
      setTransport(found.transport_allowance);
      setEmployees(found.employees_count);
      setRates(found.rates);
    } else {
      // Periodo sin registro: limpiar montos para que el desglose no se lea
      // como dato guardado del mes anterior. Las tasas sí se mantienen
      // (rara vez cambian mes a mes).
      setSalary(0);
      setTransport(0);
      setEmployees(null);
    }
  };

  const breakdown = useMemo(() => computePayroll(salary, transport, rates), [salary, transport, rates]);

  const handleSave = async () => {
    await saveEntry.mutateAsync({
      year, month,
      salary_total: salary,
      transport_allowance: transport,
      employees_count: employees,
      rates,
    });
    // Conectar al cronograma: el dashboard y Visita DIAN muestran estas
    // obligaciones en "Próximas obligaciones" con montos actualizados.
    // El cronograma refleja el registro MÁS RECIENTE, no necesariamente el
    // que se acaba de editar: corregir un mes viejo no debe pisar los
    // montos vigentes.
    const candidates = [
      ...entries
        .filter((e) => !(e.year === year && e.month === month))
        .map((e) => ({ y: e.year, m: e.month, salary: e.salary_total, transport: e.transport_allowance, rates: e.rates })),
      { y: year, m: month, salary, transport, rates },
    ];
    const latest = candidates.reduce((a, b) => (b.y > a.y || (b.y === a.y && b.m > a.m)) ? b : a);
    await syncObligations.mutateAsync({
      salary_total: latest.salary,
      transport_allowance: latest.transport,
      rates: latest.rates,
      diaPagoNomina,
      diaPagoPila,
    });
  };

  // Pasivo provisionado del año en curso (suma de los meses registrados).
  const yearEntries = useMemo(() => entries.filter((e) => e.year === now.getFullYear()), [entries]);
  const pasivo = useMemo(() => {
    let cesantias = 0, intereses = 0, prima = 0, vacaciones = 0;
    for (const e of yearEntries) {
      const b = computePayroll(e.salary_total, e.transport_allowance, e.rates);
      cesantias += b.cesantias;
      intereses += b.interesesCesantias;
      prima += b.prima;
      vacaciones += b.vacaciones;
    }
    return { cesantias, intereses, prima, vacaciones, total: cesantias + intereses + prima + vacaciones };
  }, [yearEntries]);

  const saving = saveEntry.isPending || syncObligations.isPending;

  return (
    <AppLayout>
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <HardHat className="h-6 w-6 text-primary" />
              Nómina
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Registrá la nómina de cada mes y AluminIA provisiona prestaciones, seguridad social y
              parafiscales — y agenda los pagos en el cronograma del Dashboard.
            </p>
          </div>
        </div>

        {/* ── Empleados: prestaciones y cumplimiento por persona ── */}
        <EmployeesSection />

        <div className="grid lg:grid-cols-2 gap-6">
          {/* ── Registro mensual ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Registrar mes</CardTitle>
              <CardDescription>
                Total devengado del mes (todos los empleados). No es nómina electrónica: es la
                provisión gerencial para que tu caja y tus costos no mientan.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Mes</Label>
                  <Select value={String(month)} onValueChange={(v) => loadPeriod(year, Number(v))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MONTH_NAMES.map((m, i) => (
                        <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Año</Label>
                  <Select value={String(year)} onValueChange={(v) => loadPeriod(Number(v), month)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {YEARS.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {existingForPeriod && (
                <p className="text-[11px] text-muted-foreground bg-muted/40 rounded-md px-2.5 py-1.5">
                  Este periodo ya tiene registro — al guardar lo actualizás.
                </p>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs">Salarios del mes (sin auxilio de transporte)</Label>
                <Input
                  type="number" min="0" placeholder="Ej: 12000000"
                  value={salary || ''}
                  onChange={(e) => setSalary(Number(e.target.value) || 0)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Auxilio de transporte (total)</Label>
                  <Input
                    type="number" min="0" placeholder="Ej: 800000"
                    value={transport || ''}
                    onChange={(e) => setTransport(Number(e.target.value) || 0)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs"># Empleados</Label>
                  <Input
                    type="number" min="0" placeholder="Ej: 8"
                    value={employees ?? ''}
                    onChange={(e) => setEmployees(e.target.value ? Number(e.target.value) : null)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Día de pago de nómina</Label>
                  <Input
                    type="number" min="1" max="31"
                    value={diaPagoNomina}
                    onChange={(e) => setDiaPagoNomina(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Día de pago PILA</Label>
                  <Input
                    type="number" min="1" max="31"
                    value={diaPagoPila}
                    onChange={(e) => setDiaPagoPila(Number(e.target.value))}
                  />
                </div>
              </div>

              {/* Tasas (colapsable) */}
              <button
                type="button"
                onClick={() => setShowRates(!showRates)}
                className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              >
                {showRates ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                Tasas aplicadas (defaults legales 2026)
              </button>
              {showRates && (
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <Label className="text-xs font-medium">Exoneración Art. 114-1 ET</Label>
                      <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">
                        Persona jurídica con empleados que ganan menos de 10 SMMLV: no paga salud
                        patronal (8.5%), SENA (2%) ni ICBF (3%). La caja (4%) se paga siempre.
                      </p>
                    </div>
                    <Switch
                      checked={rates.exoneradoArt114}
                      onCheckedChange={(v) => setRates({ ...rates, exoneradoArt114: v })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">Clase de riesgo ARL</Label>
                    <Select
                      value={String(rates.arl)}
                      onValueChange={(v) => setRates({ ...rates, arl: Number(v) })}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {ARL_CLASES.map((c) => (
                          <SelectItem key={c.rate} value={String(c.rate)}>
                            {c.clase} — {c.rate}%
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    <RateInput label="Cesantías" value={rates.cesantias} onChange={(n) => setRates({ ...rates, cesantias: n })} />
                    <RateInput label="Int. cesantías" value={rates.interesesCesantias} onChange={(n) => setRates({ ...rates, interesesCesantias: n })} />
                    <RateInput label="Prima" value={rates.prima} onChange={(n) => setRates({ ...rates, prima: n })} />
                    <RateInput label="Vacaciones" value={rates.vacaciones} onChange={(n) => setRates({ ...rates, vacaciones: n })} />
                    <RateInput label="Pensión patronal" value={rates.pension} onChange={(n) => setRates({ ...rates, pension: n })} />
                    <RateInput label="Caja compensación" value={rates.caja} onChange={(n) => setRates({ ...rates, caja: n })} />
                  </div>
                </div>
              )}

              <Button onClick={handleSave} disabled={!editable || saving || salary <= 0} className="w-full gap-2">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Guardar y actualizar cronograma
              </Button>
              {!editable && (
                <p className="text-[11px] text-muted-foreground text-center">
                  Tenés acceso de solo lectura a este módulo.
                </p>
              )}
            </CardContent>
          </Card>

          {/* ── Desglose en vivo ── */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                Costo laboral de {MONTH_NAMES[month - 1]} {year}
              </CardTitle>
              <CardDescription>
                Lo que de verdad te cuesta la nómina — no solo lo que pagás el {diaPagoNomina} de cada mes.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <BreakdownRow label="Devengado (salarios + aux. transporte)" value={salary + transport} />
              </div>
              <div className="space-y-1.5 rounded-lg bg-muted/30 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Provisión de prestaciones (pasivo que se acumula)
                </p>
                <BreakdownRow label={`Cesantías (${rates.cesantias}%)`} value={breakdown.cesantias} />
                <BreakdownRow label={`Intereses de cesantías (${rates.interesesCesantias}%)`} value={breakdown.interesesCesantias} />
                <BreakdownRow label={`Prima de servicios (${rates.prima}%)`} value={breakdown.prima} />
                <BreakdownRow label={`Vacaciones (${rates.vacaciones}%)`} value={breakdown.vacaciones} />
                <BreakdownRow label="Subtotal provisión" value={breakdown.provisionPrestaciones} bold />
              </div>
              <div className="space-y-1.5 rounded-lg bg-muted/30 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Seguridad social patronal + parafiscales
                </p>
                {!rates.exoneradoArt114 && <BreakdownRow label={`Salud (${rates.salud}%)`} value={breakdown.salud} />}
                <BreakdownRow label={`Pensión (${rates.pension}%)`} value={breakdown.pension} />
                <BreakdownRow label={`ARL (${rates.arl}%)`} value={breakdown.arl} />
                <BreakdownRow label={`Caja de compensación (${rates.caja}%)`} value={breakdown.caja} />
                {!rates.exoneradoArt114 && (
                  <>
                    <BreakdownRow label={`SENA (${rates.sena}%)`} value={breakdown.sena} />
                    <BreakdownRow label={`ICBF (${rates.icbf}%)`} value={breakdown.icbf} />
                  </>
                )}
                <BreakdownRow label="Subtotal aportes" value={breakdown.seguridadSocial + breakdown.parafiscales} bold />
              </div>
              <div className="flex items-center justify-between rounded-lg border-2 border-primary/20 bg-primary/5 px-3 py-2.5">
                <span className="text-sm font-semibold text-foreground">Costo laboral total del mes</span>
                <span className="text-base font-bold text-primary tabular-nums">{fmt(breakdown.totalCostoLaboral)}</span>
              </div>
              <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>
                  PILA estimada del mes: <strong>{fmt(breakdown.pilaEstimado)}</strong> (aportes
                  patronales + 8% retenido a empleados). Verificá la liquidación final con tu contador.
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Pasivo provisionado del año ── */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-lg">Pasivo laboral provisionado — {now.getFullYear()}</CardTitle>
              <CardDescription>
                Plata que ya le debés a tus empleados aunque todavía no la pagaste. Se descarga con la
                prima (jun/dic), las cesantías (feb) y los intereses (ene).
              </CardDescription>
            </div>
            <Link
              to="/visita-dian"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline shrink-0"
            >
              <CalendarClock className="h-3.5 w-3.5" />
              Ver cronograma completo <ArrowRight className="h-3 w-3" />
            </Link>
          </CardHeader>
          <CardContent>
            {yearEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-3">
                Sin meses registrados este año. Guardá tu primer mes para empezar a provisionar.
              </p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  { label: 'Cesantías', value: pasivo.cesantias, hint: 'Consignar antes del 14 feb' },
                  { label: 'Int. cesantías', value: pasivo.intereses, hint: 'Pagar antes del 31 ene' },
                  { label: 'Prima', value: pasivo.prima, hint: 'Jun 30 y Dic 20' },
                  { label: 'Vacaciones', value: pasivo.vacaciones, hint: 'Al disfrutarlas' },
                  { label: 'Total provisionado', value: pasivo.total, hint: `${yearEntries.length} mes(es) registrados`, bold: true },
                ].map((c) => (
                  <div key={c.label} className={`rounded-lg border p-3 ${c.bold ? 'border-primary/30 bg-primary/5' : 'border-border'}`}>
                    <p className="text-[11px] text-muted-foreground">{c.label}</p>
                    <p className={`text-sm font-bold tabular-nums mt-1 ${c.bold ? 'text-primary' : 'text-foreground'}`}>{fmt(c.value)}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{c.hint}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Historial ── */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Historial</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : entries.length === 0 ? (
              <p className="text-sm text-muted-foreground py-3">Todavía no registraste ningún mes.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Periodo</TableHead>
                    <TableHead className="text-right">Devengado</TableHead>
                    <TableHead className="text-right">Provisión</TableHead>
                    <TableHead className="text-right">Aportes</TableHead>
                    <TableHead className="text-right">Costo total</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((e: PayrollEntry) => (
                    <TableRow
                      key={e.id}
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => loadPeriod(e.year, e.month)}
                    >
                      <TableCell className="font-medium text-sm">
                        {MONTH_NAMES[e.month - 1]} {e.year}
                        {e.employees_count ? (
                          <span className="text-[10px] text-muted-foreground ml-1.5">{e.employees_count} emp.</span>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{fmt(e.salary_total + e.transport_allowance)}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{fmt(e.provision_prestaciones)}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{fmt(e.seguridad_social + e.parafiscales)}</TableCell>
                      <TableCell className="text-right text-sm font-semibold tabular-nums">{fmt(e.total_costo_laboral)}</TableCell>
                      <TableCell>
                        {editable && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={(ev) => {
                              ev.stopPropagation();
                              if (window.confirm(`¿Eliminar el registro de ${MONTH_NAMES[e.month - 1]} ${e.year}?`)) {
                                deleteEntry.mutate(e.id);
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
