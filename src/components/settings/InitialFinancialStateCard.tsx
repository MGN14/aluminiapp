// Estado Financiero Inicial — el snapshot de tu negocio cuando arrancás
// con AluminIA. 7 secciones colapsables, autosave por sección.
//
// Estructura post-rework (pedido por Nico, 2026-04):
//   1. Saldos en cuentas       — efectivo + bancos (detalle por cuenta)
//   2. Deudas                   — tarjetas + préstamos (detalle por entidad)
//   3. Cuentas por cobrar       — facturas pendientes de cobro (por cliente)
//   4. Cuentas por pagar        — facturas pendientes de pago (por proveedor)
//   5. Anticipos de clientes    — te pagaron sin facturar (por cliente, ↔ factura opcional)
//   6. Anticipos a proveedores  — pagaste sin factura recibida (por proveedor)
//   7. Saldo IVA a favor        — un solo número (si es en contra → 0)
//
// Cuidado clave: la lógica de matching de anticipos↔factura (invoice_id) la
// mantenemos intacta — varios módulos la usan (CxC report, FinancialHealth,
// AdvancesReport, OperationalSummaryCards).

import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Plus, Trash2, Loader2, Check, AlertCircle, ChevronDown, ChevronRight,
  Wallet, CreditCard, ArrowDownToLine, ArrowUpFromLine, HandCoins, Coins, Receipt,
  Info, Save,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  useInitialFinancialState,
  type InitialStateDetail,
  type InitialStateFormData,
  sumDetailsByType,
  getTotalActivos,
  getTotalPasivos,
  getPatrimonio,
} from '@/hooks/useInitialFinancialState';

const ACCOUNT_TYPE_HINTS = [
  'Efectivo en caja',
  'Bancolombia (corriente)',
  'Bancolombia (ahorros)',
  'Davivienda',
  'BBVA',
  'Banco de Bogotá',
  'Nequi / Daviplata',
];

const DEBT_TYPE_HINTS = [
  'Tarjeta Visa Bancolombia',
  'Tarjeta MasterCard',
  'Préstamo BBVA',
  'Crédito de consumo',
  'Sobregiro bancario',
];

function formatCOP(n: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP',
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Math.round(n || 0));
}

// es-CO: "." es separador de miles (siempre) y "," es decimal. Como el input
// se re-formatea en cada keystroke con Intl es-CO, los puntos que vea el
// parser son SIEMPRE miles. Antes había una heurística "si el último grupo
// no tiene 3 dígitos, es decimal" que rompía mid-tipeo: al pasar de 1.525
// a 15.259, en el medio veía "1.5259" y lo parseaba como 1.5259 → quedaba
// trabado en 1.525.
function parseAmount(v: string): number {
  const cleaned = v.replace(/[^\d,-]/g, '');
  if (cleaned.includes(',')) {
    return Number(cleaned.replace(',', '.')) || 0;
  }
  return Number(cleaned) || 0;
}

interface ResponsibleOption {
  id: string;
  name: string;
}

// ---------------- Section component ----------------

interface SectionProps {
  open: boolean;
  onToggle: () => void;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  hint: string;
  total: number;
  totalLabel: string;
  totalColor: 'success' | 'destructive' | 'primary' | 'neutral';
  children: React.ReactNode;
  itemCount?: number;
}

function Section({ open, onToggle, icon: Icon, title, hint, total, totalLabel, totalColor, children, itemCount }: SectionProps) {
  const colorClass = {
    success: 'text-success',
    destructive: 'text-destructive',
    primary: 'text-primary',
    neutral: 'text-foreground',
  }[totalColor];

  return (
    <div className="border rounded-lg overflow-hidden bg-background">
      <button
        type="button"
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center gap-3 hover:bg-muted/50 transition-colors text-left"
      >
        {open ? <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
        <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium">{title}</span>
            {typeof itemCount === 'number' && itemCount > 0 && (
              <span className="text-[11px] text-muted-foreground">· {itemCount} {itemCount === 1 ? 'línea' : 'líneas'}</span>
            )}
          </div>
          {!open && hint && (
            <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{hint}</p>
          )}
        </div>
        <div className="text-right flex-shrink-0">
          <div className={`text-sm font-semibold tabular-nums ${colorClass}`}>{formatCOP(total)}</div>
          <div className="text-[10px] text-muted-foreground uppercase tracking-wider">{totalLabel}</div>
        </div>
      </button>
      {open && (
        <div className="px-4 pb-4 pt-2 border-t bg-muted/20">
          {hint && (
            <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{hint}</p>
          )}
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------- Detail row ----------------

interface DetailRowProps {
  detail: InitialStateDetail;
  index: number;
  responsibles: ResponsibleOption[];
  hints: string[];
  namePlaceholder: string;
  onUpdate: (idx: number, updates: Partial<InitialStateDetail>) => void;
  onRemove: (idx: number) => void;
  showResponsibleSelect?: boolean;
}

function DetailRow({ detail, index, responsibles, hints, namePlaceholder, onUpdate, onRemove, showResponsibleSelect }: DetailRowProps) {
  return (
    <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center bg-background rounded-md p-2 border">
      <div className="flex-1 min-w-0">
        {showResponsibleSelect && responsibles.length > 0 ? (
          <Select
            value={detail.responsible_id ?? '__custom__'}
            onValueChange={(v) => {
              if (v === '__custom__') {
                onUpdate(index, { responsible_id: null });
              } else {
                const r = responsibles.find(x => x.id === v);
                if (r) onUpdate(index, { responsible_id: r.id, responsible_name: r.name });
              }
            }}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue placeholder="Seleccionar..." />
            </SelectTrigger>
            <SelectContent>
              {responsibles.map(r => (
                <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
              ))}
              <SelectItem value="__custom__">+ Escribir nombre nuevo</SelectItem>
            </SelectContent>
          </Select>
        ) : (
          <>
            <Input
              placeholder={namePlaceholder}
              list={hints.length ? `hints-${detail.field_type}-${index}` : undefined}
              value={detail.responsible_name}
              onChange={(e) => onUpdate(index, { responsible_name: e.target.value, responsible_id: null })}
              className="h-9 text-sm"
            />
            {hints.length > 0 && (
              <datalist id={`hints-${detail.field_type}-${index}`}>
                {hints.map(h => <option key={h} value={h} />)}
              </datalist>
            )}
          </>
        )}
      </div>
      <div className="w-full sm:w-48">
        <Input
          type="text"
          inputMode="decimal"
          placeholder="$0"
          value={detail.amount > 0 ? new Intl.NumberFormat('es-CO').format(detail.amount) : ''}
          onChange={(e) => onUpdate(index, { amount: parseAmount(e.target.value) })}
          className="h-9 text-sm tabular-nums text-right"
        />
      </div>
      <Button variant="ghost" size="icon" onClick={() => onRemove(index)} className="h-9 w-9 shrink-0">
        <Trash2 className="h-4 w-4 text-muted-foreground" />
      </Button>
    </div>
  );
}

// ---------------- Main component ----------------

export default function InitialFinancialStateCard() {
  const { user } = useAuth();
  const {
    initialData,
    initialDetails,
    loading,
    save,
    autoSave,
    saveStatus,
    setOnIdsResolved,
  } = useInitialFinancialState();

  const [form, setForm] = useState<InitialStateFormData>({
    fecha_inicio: new Date().toISOString().slice(0, 10),
    iva_a_favor: 0,
  });
  const [details, setDetails] = useState<InitialStateDetail[]>([]);
  const [responsibles, setResponsibles] = useState<ResponsibleOption[]>([]);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set());

  // Hidratación one-shot: copiamos initialData/initialDetails al state local
  // SOLO la primera vez. Si re-sincronizáramos en cada cambio de
  // initialDetails (que el hook actualiza tras un save), sobreescribiríamos
  // cambios concurrentes — ej: el usuario selecciona un cliente mientras
  // un autosave anterior está en vuelo y la respuesta lo borra.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (loading) return;
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    if (initialData) {
      setForm({
        fecha_inicio: initialData.fecha_inicio?.slice(0, 10) || new Date().toISOString().slice(0, 10),
        iva_a_favor: initialData.iva_a_favor || 0,
      });
    }
    setDetails(initialDetails);
  }, [loading, initialData, initialDetails]);

  // Aplica el mapping tmp-id → uuid real tras un autosave/save exitoso.
  // Solo muta el campo `id` — preserva cualquier cambio en otros campos
  // hecho durante el save en vuelo (ej: cliente recién seleccionado).
  useEffect(() => {
    setOnIdsResolved((idMap) => {
      setDetails(prev => prev.map(d =>
        d.id && idMap.has(d.id) ? { ...d, id: idMap.get(d.id)! } : d
      ));
    });
    return () => setOnIdsResolved(null);
  }, [setOnIdsResolved]);

  // Autosave: 1.2s sin cambios → persiste. Bug real reportado: usuario
  // cargaba saldos sin clickear "Guardar" → datos no persistían.
  useEffect(() => {
    if (!hydratedRef.current) return;
    autoSave(form, details);
  }, [form, details, autoSave]);

  useEffect(() => {
    if (!user) return;
    supabase
      .from('responsibles')
      .select('id, name')
      .order('name')
      .then(({ data }) => {
        if (data) setResponsibles(data as any);
      });
  }, [user]);

  const addDetail = useCallback((field_type: InitialStateDetail['field_type']) => {
    // Asigna id local (`tmp-...`) para que React tenga key estable durante el
    // lifecycle del item nuevo (sin esto, key={index} causaba pérdida de focus
    // al borrar otro item porque los índices se compactan).
    const tmpId = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setDetails(prev => [...prev, { id: tmpId, field_type, responsible_id: null, responsible_name: '', amount: 0 }]);
  }, []);

  const updateDetail = useCallback((globalIdx: number, updates: Partial<InitialStateDetail>) => {
    setDetails(prev => prev.map((d, i) => (i === globalIdx ? { ...d, ...updates } : d)));
  }, []);

  const removeDetail = useCallback((globalIdx: number) => {
    setDetails(prev => prev.filter((_, i) => i !== globalIdx));
  }, []);

  const getItemsWithIndex = useCallback((field_type: InitialStateDetail['field_type']) => {
    const out: Array<{ detail: InitialStateDetail; index: number }> = [];
    details.forEach((d, i) => {
      if (d.field_type === field_type) out.push({ detail: d, index: i });
    });
    return out;
  }, [details]);

  const totalSaldos = sumDetailsByType(details, 'saldo_cuentas');
  const totalDeudas = sumDetailsByType(details, 'deudas');
  const totalCxC = sumDetailsByType(details, 'cuentas_por_cobrar');
  const totalCxP = sumDetailsByType(details, 'cuentas_por_pagar');
  const totalAntCli = sumDetailsByType(details, 'anticipos_de_clientes');
  const totalAntProv = sumDetailsByType(details, 'anticipos_a_proveedores');

  const totalActivos = getTotalActivos(form, details);
  const totalPasivos = getTotalPasivos(form, details);
  const patrimonio = getPatrimonio(form, details);

  const toggleSection = (k: string) => {
    setOpenSections(prev => {
      const n = new Set(prev);
      if (n.has(k)) n.delete(k); else n.add(k);
      return n;
    });
  };

  const handleSave = async () => {
    await save(form, details);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Cargando estado financiero…</span>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" />
              Estado financiero inicial
            </CardTitle>
            <CardDescription className="mt-1 text-sm">
              El snapshot de tu negocio el día que empezás con AluminIA. Estos
              datos se usan como base para todos los reportes — flujo de caja,
              CxC, CxP, salud financiera.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {saveStatus === 'saving' && (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" /> Guardando…
              </span>
            )}
            {saveStatus === 'saved' && (
              <span className="text-xs text-success inline-flex items-center gap-1">
                <Check className="h-3 w-3" /> Guardado
              </span>
            )}
            {saveStatus === 'error' && (
              <span className="text-xs text-destructive inline-flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> Error al guardar
              </span>
            )}
            <Button onClick={handleSave} size="sm" className="gap-2">
              <Save className="h-4 w-4" />
              Guardar
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div>
          <Label htmlFor="fecha-inicio" className="text-xs">Fecha de inicio del seguimiento</Label>
          <Input
            id="fecha-inicio"
            type="date"
            value={form.fecha_inicio}
            onChange={(e) => setForm(f => ({ ...f, fecha_inicio: e.target.value }))}
            className="mt-1 h-9 max-w-xs"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Los movimientos antes de esta fecha se consideran "pasado" — todos los saldos abajo deben corresponder a este día.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2 p-3 rounded-lg bg-muted/40 border">
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Activos</p>
            <p className="text-base font-bold text-success tabular-nums mt-1">{formatCOP(totalActivos)}</p>
          </div>
          <div className="text-center border-x">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Pasivos</p>
            <p className="text-base font-bold text-destructive tabular-nums mt-1">{formatCOP(totalPasivos)}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Patrimonio</p>
            <p className={`text-base font-bold tabular-nums mt-1 ${patrimonio >= 0 ? 'text-primary' : 'text-destructive'}`}>{formatCOP(patrimonio)}</p>
          </div>
        </div>

        {/* 1. Saldos en cuentas */}
        <Section
          open={openSections.has('saldo')}
          onToggle={() => toggleSection('saldo')}
          icon={Wallet}
          title="Saldos en cuentas"
          hint="Cuánto tenés en cada banco y en efectivo a la fecha de inicio. Suma para tu Flujo de caja y Dashboard."
          total={totalSaldos}
          totalLabel="Total"
          totalColor="success"
          itemCount={getItemsWithIndex('saldo_cuentas').length}
        >
          <div className="space-y-2">
            {getItemsWithIndex('saldo_cuentas').map(({ detail, index }) => (
              <DetailRow
                key={detail.id ?? `idx-${index}`}
                detail={detail}
                index={index}
                responsibles={[]}
                hints={ACCOUNT_TYPE_HINTS}
                namePlaceholder="Bancolombia, Caja efectivo, etc."
                onUpdate={updateDetail}
                onRemove={removeDetail}
              />
            ))}
            <Button variant="outline" size="sm" onClick={() => addDetail('saldo_cuentas')} className="gap-2">
              <Plus className="h-4 w-4" /> Agregar cuenta
            </Button>
          </div>
        </Section>

        {/* 2. Deudas */}
        <Section
          open={openSections.has('deudas')}
          onToggle={() => toggleSection('deudas')}
          icon={CreditCard}
          title="Deudas"
          hint="Tarjetas de crédito, préstamos, sobregiros. Aparecen como pasivos al inicio en CxP."
          total={totalDeudas}
          totalLabel="Total"
          totalColor="destructive"
          itemCount={getItemsWithIndex('deudas').length}
        >
          <div className="space-y-2">
            {getItemsWithIndex('deudas').map(({ detail, index }) => (
              <DetailRow
                key={detail.id ?? `idx-${index}`}
                detail={detail}
                index={index}
                responsibles={[]}
                hints={DEBT_TYPE_HINTS}
                namePlaceholder="Tarjeta Visa, Préstamo BBVA..."
                onUpdate={updateDetail}
                onRemove={removeDetail}
              />
            ))}
            <Button variant="outline" size="sm" onClick={() => addDetail('deudas')} className="gap-2">
              <Plus className="h-4 w-4" /> Agregar deuda
            </Button>
          </div>
        </Section>

        {/* 3. CxC */}
        <Section
          open={openSections.has('cxc')}
          onToggle={() => toggleSection('cxc')}
          icon={ArrowDownToLine}
          title="Cuentas por cobrar (lo que te deben)"
          hint="Facturas emitidas a clientes que aún no te pagaron a la fecha de inicio. Aparece en el reporte 'Lo que me deben'."
          total={totalCxC}
          totalLabel="Total"
          totalColor="primary"
          itemCount={getItemsWithIndex('cuentas_por_cobrar').length}
        >
          <div className="space-y-2">
            {getItemsWithIndex('cuentas_por_cobrar').map(({ detail, index }) => (
              <DetailRow
                key={detail.id ?? `idx-${index}`}
                detail={detail}
                index={index}
                responsibles={responsibles}
                hints={[]}
                namePlaceholder="Cliente"
                onUpdate={updateDetail}
                onRemove={removeDetail}
                showResponsibleSelect
              />
            ))}
            <Button variant="outline" size="sm" onClick={() => addDetail('cuentas_por_cobrar')} className="gap-2">
              <Plus className="h-4 w-4" /> Agregar cliente
            </Button>
          </div>
        </Section>

        {/* 4. CxP */}
        <Section
          open={openSections.has('cxp')}
          onToggle={() => toggleSection('cxp')}
          icon={ArrowUpFromLine}
          title="Cuentas por pagar (lo que debés)"
          hint="Facturas de proveedores que aún no pagaste. Aparece en el reporte 'Lo que debo'."
          total={totalCxP}
          totalLabel="Total"
          totalColor="destructive"
          itemCount={getItemsWithIndex('cuentas_por_pagar').length}
        >
          <div className="space-y-2">
            {getItemsWithIndex('cuentas_por_pagar').map(({ detail, index }) => (
              <DetailRow
                key={detail.id ?? `idx-${index}`}
                detail={detail}
                index={index}
                responsibles={responsibles}
                hints={[]}
                namePlaceholder="Proveedor"
                onUpdate={updateDetail}
                onRemove={removeDetail}
                showResponsibleSelect
              />
            ))}
            <Button variant="outline" size="sm" onClick={() => addDetail('cuentas_por_pagar')} className="gap-2">
              <Plus className="h-4 w-4" /> Agregar proveedor
            </Button>
          </div>
        </Section>

        {/* 5. Anticipos de clientes */}
        <Section
          open={openSections.has('ant_cli')}
          onToggle={() => toggleSection('ant_cli')}
          icon={HandCoins}
          title="Anticipos de clientes"
          hint="Plata que ya cobraste pero todavía no facturaste. Cuando emitas la factura, podrás vincularla y se descontará automáticamente del CxC."
          total={totalAntCli}
          totalLabel="Total"
          totalColor="destructive"
          itemCount={getItemsWithIndex('anticipos_de_clientes').length}
        >
          <Alert className="mb-3 bg-primary/5 border-primary/30">
            <Info className="h-4 w-4 text-primary" />
            <AlertDescription className="text-xs">
              <strong>Importante:</strong> Los anticipos vinculados a una factura se descuentan del saldo pendiente en el reporte CxC.
              La vinculación se hace al confirmar la factura en el módulo de facturas.
            </AlertDescription>
          </Alert>
          <div className="space-y-2">
            {getItemsWithIndex('anticipos_de_clientes').map(({ detail, index }) => (
              <DetailRow
                key={detail.id ?? `idx-${index}`}
                detail={detail}
                index={index}
                responsibles={responsibles}
                hints={[]}
                namePlaceholder="Cliente"
                onUpdate={updateDetail}
                onRemove={removeDetail}
                showResponsibleSelect
              />
            ))}
            <Button variant="outline" size="sm" onClick={() => addDetail('anticipos_de_clientes')} className="gap-2">
              <Plus className="h-4 w-4" /> Agregar anticipo
            </Button>
          </div>
        </Section>

        {/* 6. Anticipos a proveedores */}
        <Section
          open={openSections.has('ant_prov')}
          onToggle={() => toggleSection('ant_prov')}
          icon={Coins}
          title="Anticipos a proveedores"
          hint="Plata que pagaste a proveedores antes de recibir la factura. Aparece como activo (te lo deben en producto/servicio)."
          total={totalAntProv}
          totalLabel="Total"
          totalColor="success"
          itemCount={getItemsWithIndex('anticipos_a_proveedores').length}
        >
          <div className="space-y-2">
            {getItemsWithIndex('anticipos_a_proveedores').map(({ detail, index }) => (
              <DetailRow
                key={detail.id ?? `idx-${index}`}
                detail={detail}
                index={index}
                responsibles={responsibles}
                hints={[]}
                namePlaceholder="Proveedor"
                onUpdate={updateDetail}
                onRemove={removeDetail}
                showResponsibleSelect
              />
            ))}
            <Button variant="outline" size="sm" onClick={() => addDetail('anticipos_a_proveedores')} className="gap-2">
              <Plus className="h-4 w-4" /> Agregar anticipo
            </Button>
          </div>
        </Section>

        {/* 7. IVA a favor */}
        <Section
          open={openSections.has('iva')}
          onToggle={() => toggleSection('iva')}
          icon={Receipt}
          title="Saldo IVA a favor"
          hint="Saldo del IVA que la DIAN te debe (de declaraciones anteriores)."
          total={form.iva_a_favor}
          totalLabel="Total"
          totalColor="success"
        >
          <Alert className="mb-3 bg-amber-50 border-amber-300 dark:bg-amber-950/20">
            <Info className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-xs">
              Si tu saldo de IVA es <strong>en contra</strong> (le debés a la DIAN), dejá este campo en <strong>0</strong>.
              Esa deuda se registra como obligación pendiente en el módulo de Visita DIAN, no acá.
            </AlertDescription>
          </Alert>
          <div className="max-w-xs">
            <Label className="text-xs">IVA a favor (saldo a tu favor)</Label>
            <Input
              type="text"
              inputMode="decimal"
              placeholder="$0"
              value={form.iva_a_favor > 0 ? new Intl.NumberFormat('es-CO').format(form.iva_a_favor) : ''}
              onChange={(e) => setForm(f => ({ ...f, iva_a_favor: parseAmount(e.target.value) }))}
              className="mt-1 h-9 tabular-nums text-right"
            />
          </div>
        </Section>

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button onClick={handleSave} size="sm" className="gap-2">
            <Save className="h-4 w-4" />
            Guardar estado financiero
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
