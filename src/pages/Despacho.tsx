import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useScannerGun } from '@/hooks/useScannerGun';
import { parseScan, normalizeRef } from '@/lib/qrLabel';
import { beep } from '@/lib/scanFeedback';
import type { InventoryProduct } from '@/hooks/useInventoryData';
import {
  fetchProductsByRefs, applyRemisionInventory, type RemisionItemInput,
} from '@/lib/remisionInventory';
import { useDataOwner } from '@/hooks/useDataOwner';
import { printRemisionToWindow } from '@/lib/printRemision';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Truck, Check, Plus, Minus, ScanLine, AlertTriangle, RadioTower, Loader2,
  ArrowLeft, Trash2, UserPlus, MapPin, FileCheck, ClipboardList, Undo2, User,
} from 'lucide-react';
import DispatchFromOrder from '@/components/scanner/DispatchFromOrder';

const STORAGE_KEY = 'despacho:nuevo:v1';
const NEW_RESP = '__new__';

interface ScanItem { reference: string; quantity: number; }

export default function Despacho() {
  const { user } = useAuth();
  const { dataOwnerId } = useDataOwner();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [mode, setMode] = useState<null | 'libre' | 'pedido'>(null);
  const [step, setStep] = useState<'setup' | 'scan'>('setup');
  const [responsibleId, setResponsibleId] = useState('');
  const [beneficiary, setBeneficiary] = useState('');
  const [creatingResp, setCreatingResp] = useState(false);
  const [newRespName, setNewRespName] = useState('');
  const [scanned, setScanned] = useState<Record<string, ScanItem>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'warn'; text: string; sub?: string } | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [lastScan, setLastScan] = useState<{ key: string; qty: number } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [manualRef, setManualRef] = useState('');
  const [manualQty, setManualQty] = useState(1);
  const [saving, setSaving] = useState(false);
  const flashTimer = useRef<number | null>(null);
  const lastKeyTimer = useRef<number | null>(null);

  // Restaurar / persistir el despacho en curso (sobrevive un refresh).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        setStep(o.step || 'setup');
        setResponsibleId(o.responsibleId || '');
        setBeneficiary(o.beneficiary || '');
        setScanned(o.scanned || {});
        setOrder(o.order || []);
        if ((o.order || []).length > 0) setMode('libre');
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ step, responsibleId, beneficiary, scanned, order })); } catch { /* ignore */ }
  }, [step, responsibleId, beneficiary, scanned, order]);

  // Productos (para resolver descripción/ubicación/costo — el costo NO se muestra).
  const { data: products = [] } = useQuery({
    queryKey: ['despacho-products', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('inventory_products').select('*').eq('active', true);
      if (error) throw error;
      return (data || []) as InventoryProduct[];
    },
    enabled: !!user?.id,
  });

  const productByRef = useMemo(() => {
    const m = new Map<string, InventoryProduct>();
    for (const p of products) { const k = normalizeRef(p.reference); if (k) m.set(k, p); }
    return m;
  }, [products]);

  // Clientes/proveedores (mismo patrón que NewRemisionModal — RLS resuelve owner).
  const { data: responsibles = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['responsibles-despacho', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('responsibles')
        .select('id, name, responsible_type')
        .eq('active', true)
        .order('name');
      if (error) throw error;
      return ((data ?? []) as unknown as Array<{ id: string; name: string; responsible_type: string }>)
        .filter(r => r.responsible_type === 'banking' || r.responsible_type === 'both' || !r.responsible_type)
        .map(r => ({ id: r.id, name: r.name }));
    },
  });

  // Datos de la empresa (del owner) para el encabezado de la remisión impresa.
  const { data: company } = useQuery({
    queryKey: ['despacho-company', dataOwnerId],
    enabled: !!dataOwnerId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('company_name, company_nit, company_address, company_city')
        .eq('user_id', dataOwnerId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as {
        company_name?: string; company_nit?: string; company_address?: string; company_city?: string;
      } | null;
    },
  });

  const flashMsg = useCallback((kind: 'ok' | 'warn', text: string, sub?: string) => {
    setFlash({ kind, text, sub });
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 1700);
  }, []);

  const addItem = useCallback((rawRef: string, qty: number) => {
    const key = normalizeRef(rawRef);
    if (!key) return;
    const prod = productByRef.get(key);
    const displayRef = prod?.reference ?? rawRef.trim();
    setScanned(prev => ({ ...prev, [key]: { reference: displayRef, quantity: (prev[key]?.quantity || 0) + qty } }));
    setOrder(prev => prev.includes(key) ? prev : [key, ...prev]);
    setLastKey(key);
    setLastScan({ key, qty });
    if (lastKeyTimer.current) window.clearTimeout(lastKeyTimer.current);
    lastKeyTimer.current = window.setTimeout(() => setLastKey(null), 1200);
    if (prod) { flashMsg('ok', `${displayRef}  +${qty}`, prod.name || undefined); beep('ok'); }
    else { flashMsg('warn', displayRef, 'Sin match en inventario'); beep('warn'); }
  }, [productByRef, flashMsg]);

  const handleScan = useCallback((raw: string) => {
    const parsed = parseScan(raw);
    if (!parsed) { flashMsg('warn', 'Código ilegible'); beep('warn'); return; }
    addItem(parsed.reference, parsed.quantity);
  }, [addItem, flashMsg]);

  useScannerGun({ onScan: handleScan, enabled: step === 'scan' && !saving });

  const adjust = (key: string, delta: number) =>
    setScanned(prev => {
      const cur = prev[key]; if (!cur) return prev;
      return { ...prev, [key]: { ...cur, quantity: Math.max(0, cur.quantity + delta) } };
    });

  const removeKey = (key: string) => {
    setScanned(prev => { const n = { ...prev }; delete n[key]; return n; });
    setOrder(prev => prev.filter(k => k !== key));
  };

  const undoLast = () => {
    if (!lastScan) return;
    const { key, qty } = lastScan;
    const cur = scanned[key]?.quantity || 0;
    const nv = Math.max(0, cur - qty);
    setScanned(prev => {
      const n = { ...prev };
      if (nv === 0) delete n[key]; else n[key] = { ...n[key], quantity: nv };
      return n;
    });
    if (nv === 0) setOrder(prev => prev.filter(k => k !== key));
    setLastScan(null);
    flashMsg('warn', 'Último escaneo deshecho', `${lastScan.key} −${qty}`);
    beep('warn');
  };

  const handleManualAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualRef.trim() || manualQty <= 0) return;
    addItem(manualRef, manualQty);
    setManualRef(''); setManualQty(1);
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const totalUnits = useMemo(() => Object.values(scanned).reduce((s, c) => s + c.quantity, 0), [scanned]);

  const handleResponsibleChange = (v: string) => {
    if (v === NEW_RESP) { setCreatingResp(true); setResponsibleId(''); setBeneficiary(''); return; }
    setResponsibleId(v); setCreatingResp(false);
    setBeneficiary(responsibles.find(r => r.id === v)?.name ?? '');
  };

  const createResponsible = async () => {
    if (!user) return;
    const name = newRespName.trim();
    if (!name) { toast({ title: 'Falta el nombre', variant: 'destructive' }); return; }
    try {
      const { data, error } = await supabase
        .from('responsibles')
        .insert({ user_id: user.id, name, responsible_type: 'banking' } as never)
        .select('id, name').single();
      if (error) throw error;
      setResponsibleId((data as any).id);
      setBeneficiary((data as any).name);
      setCreatingResp(false); setNewRespName('');
      toast({ title: 'Cliente creado' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const startScanning = () => {
    if (!beneficiary.trim() && !responsibleId) {
      toast({ title: 'Elegí el cliente del despacho', variant: 'destructive' });
      return;
    }
    setStep('scan');
    beep('ok');
  };

  const cancelDespacho = () => {
    if (order.length > 0 && !window.confirm('¿Cancelar este despacho? Se pierde lo escaneado.')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    setStep('setup'); setResponsibleId(''); setBeneficiary(''); setScanned({}); setOrder([]);
  };

  const generarRemision = async () => {
    if (!user?.id) return;
    if (order.length === 0) { toast({ title: 'Escaneá al menos un paquete', variant: 'destructive' }); return; }
    if (!beneficiary.trim() && !responsibleId) { toast({ title: 'Falta el cliente', variant: 'destructive' }); return; }

    // Abrimos la ventana de impresión YA, dentro del gesto del click, para que
    // el navegador no la bloquee (el PDF se escribe recién después del insert).
    const printWin = window.open('', '_blank', 'width=820,height=1040');

    setSaving(true);
    try {
      const items: RemisionItemInput[] = order.map(k => {
        const line = scanned[k];
        const prod = productByRef.get(k);
        return {
          reference: line.reference,
          product_name: prod?.name || line.reference,
          units: line.quantity,
          unit_cost: Number(prod?.cost_per_unit) || 0,
        };
      });

      const productMap = await fetchProductsByRefs(user.id, items.map(i => i.reference));
      const today = new Date().toISOString().split('T')[0];

      // Remisión de venta, ya despachada (Yolanda la armó escaneando lo que sale).
      // module_origin 'dian' como el resto del flujo de remisiones.
      const { data: remision, error: remError } = await (supabase.from('remisiones') as any)
        .insert({
          user_id: user.id,
          date: today,
          beneficiary: beneficiary.trim() || null,
          responsible_id: responsibleId || null,
          status: 'despachado',
          module_origin: 'dian',
          remision_type: 'venta',
          verified_at: new Date().toISOString(),
          verified_by: user.id,
          verified_units: totalUnits,
        })
        .select('id, number').single();
      if (remError) throw remError;

      const itemsToInsert = items.map(i => ({
        remision_id: remision.id,
        reference: i.reference,
        product_name: i.product_name,
        units: i.units,
        unit_cost: i.unit_cost,
        total_cost: Number(i.units) * Number(i.unit_cost),
      }));
      const { error: itemsError } = await supabase.from('remision_items').insert(itemsToInsert);
      if (itemsError) throw itemsError;

      // Descuenta del inventario FÍSICO (salida de venta).
      const result = await applyRemisionInventory({
        userId: user.id, remisionId: remision.id, remisionType: 'venta',
        movementDate: today, items, productMap,
      });

      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }

      // Imprimir la remisión (formato carta, diálogo de impresora nativo).
      if (printWin) {
        printRemisionToWindow(printWin, {
          company: {
            name: company?.company_name, nit: company?.company_nit,
            address: company?.company_address, city: company?.company_city,
          },
          number: remision.number ?? '',
          date: today,
          beneficiary: beneficiary.trim(),
          items: items.map(i => ({ reference: i.reference, product_name: i.product_name, units: i.units })),
        });
      }

      toast({
        title: `Remisión ${remision.number ?? ''} generada`,
        description: `${items.length} referencias · ${result.applied} descontadas del inventario físico.`,
      });
      navigate('/remisiones');
    } catch (e: any) {
      if (printWin) { try { printWin.close(); } catch { /* ignore */ } }
      toast({ title: 'No se pudo generar la remisión', description: e.message, variant: 'destructive' });
      setSaving(false);
    }
  };

  // ─────────────────────────── HOME (elegir modo) ───────────────────────────
  if (mode === 'pedido') {
    return <DispatchFromOrder company={company} onExit={() => setMode(null)} />;
  }
  if (mode === null) {
    return (
      <>
        <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6">
          <div className="flex items-center gap-4 mb-6">
            <div className="h-11 w-11 rounded-xl bg-blue-600/10 flex items-center justify-center flex-shrink-0">
              <Truck className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#1d1d1f', letterSpacing: '-0.6px' }}>Despacho</h1>
              <p className="text-sm text-muted-foreground">¿Cómo querés despachar?</p>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <button onClick={() => setMode('pedido')} className="text-left bg-white border rounded-2xl p-5 hover:border-blue-400 hover:shadow-sm transition active:scale-[0.99]">
              <div className="h-11 w-11 rounded-xl bg-blue-600/10 flex items-center justify-center mb-3"><ClipboardList className="h-5 w-5 text-blue-600" /></div>
              <div className="font-bold text-base">Despachar un pedido</div>
              <p className="text-sm text-muted-foreground mt-1">Elegís una remisión pendiente y escaneás; la app valida que despaches <strong>exactamente lo pedido</strong> (18/20 ✓).</p>
              <div className="text-xs font-semibold text-blue-600 mt-3 inline-flex items-center gap-1">Validado <Check className="h-3.5 w-3.5" /></div>
            </button>
            <button onClick={() => { setMode('libre'); setStep('setup'); }} className="text-left bg-white border rounded-2xl p-5 hover:border-slate-400 hover:shadow-sm transition active:scale-[0.99]">
              <div className="h-11 w-11 rounded-xl bg-slate-100 flex items-center justify-center mb-3"><ScanLine className="h-5 w-5 text-slate-500" /></div>
              <div className="font-bold text-base">Despacho nuevo (sin pedido)</div>
              <p className="text-sm text-muted-foreground mt-1">Elegís el cliente y armás la remisión escaneando lo que sale. Se genera y descuenta el físico.</p>
              <div className="text-xs font-semibold text-slate-500 mt-3">Libre</div>
            </button>
          </div>
          {order.length > 0 && (
            <p className="text-xs text-amber-600 mt-4">Tenés un despacho libre en curso con {order.length} referencias — entrá a “Despacho nuevo” para continuar.</p>
          )}
        </div>
      </>
    );
  }

  // ─────────────────────────── SETUP (despacho libre) ───────────────────────────
  if (step === 'setup') {
    return (
      <>
        <div className="max-w-xl mx-auto px-4 sm:px-6 py-6">
          <button onClick={() => setMode(null)} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
            <ArrowLeft className="h-5 w-5" /> Volver
          </button>
          <div className="flex items-center gap-4 mb-6">
            <div className="h-11 w-11 rounded-xl bg-blue-600/10 flex items-center justify-center flex-shrink-0">
              <Truck className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: '#1d1d1f', letterSpacing: '-0.6px' }}>Nuevo despacho</h1>
              <p className="text-sm text-muted-foreground">Elegí el cliente y escaneá lo que sale; al terminar se genera la remisión.</p>
            </div>
          </div>

          <div className="bg-white border rounded-2xl p-5 space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Cliente / destino del despacho</label>
              {creatingResp ? (
                <div className="flex gap-2">
                  <Input autoFocus placeholder="Ej: Ingealuminios" value={newRespName} onChange={e => setNewRespName(e.target.value)} />
                  <button onClick={createResponsible} className="h-10 px-4 rounded-xl bg-[#1d1d1f] text-white text-sm font-semibold whitespace-nowrap">Crear</button>
                  <button onClick={() => { setCreatingResp(false); setNewRespName(''); }} className="h-10 px-3 rounded-xl border text-sm">Cancelar</button>
                </div>
              ) : (
                <Select value={responsibleId} onValueChange={handleResponsibleChange}>
                  <SelectTrigger className="h-11"><SelectValue placeholder="Seleccionar cliente…" /></SelectTrigger>
                  <SelectContent>
                    {responsibles.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    <SelectItem value={NEW_RESP} className="text-primary">
                      <span className="inline-flex items-center gap-1.5"><UserPlus className="h-3.5 w-3.5" /> Crear nuevo</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            <button
              onClick={startScanning}
              className="w-full h-12 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold inline-flex items-center justify-center gap-2"
            >
              <ScanLine className="h-5 w-5" /> Empezar a escanear
            </button>
            {order.length > 0 && (
              <p className="text-xs text-amber-600 text-center">
                Tenés un despacho en curso con {order.length} referencias escaneadas — al empezar continúa donde quedó.
              </p>
            )}
          </div>
        </div>
      </>
    );
  }

  // ─────────────────────────── SCAN ───────────────────────────
  const accent = flash?.kind === 'ok' ? 'green' : flash?.kind === 'warn' ? 'red' : 'idle';

  return (
    <>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {/* Encabezado */}
        <div className="flex items-center justify-between gap-3">
          <button onClick={() => setStep('setup')} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" /> Cliente
          </button>
          <div className="text-right min-w-0">
            <div className="text-xs text-muted-foreground">Despacho a</div>
            <div className="font-bold leading-tight truncate">{beneficiary || 'Sin cliente'}</div>
          </div>
        </div>

        {user?.email && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <User className="h-3.5 w-3.5" /> Operario: <span className="font-medium text-foreground">{user.email}</span>
          </div>
        )}

        {/* Tarjeta de escaneo */}
        <div className={`rounded-2xl border-2 px-5 py-4 flex items-center gap-4 transition-colors ${
          accent === 'green' ? 'border-emerald-400 bg-emerald-50/40'
          : accent === 'red' ? 'border-red-300 bg-red-50/40'
          : 'border-dashed border-slate-300 bg-white'
        }`}>
          <div className={`h-12 w-12 rounded-2xl flex items-center justify-center flex-shrink-0 ${
            accent === 'green' ? 'bg-emerald-500 text-white' : accent === 'red' ? 'bg-red-500 text-white' : 'bg-slate-100 text-slate-400'
          }`}>
            {accent === 'green' ? <Check className="h-6 w-6" /> : accent === 'red' ? <AlertTriangle className="h-6 w-6" /> : <RadioTower className="h-6 w-6 animate-pulse" />}
          </div>
          <div className="min-w-0 flex-1">
            {flash ? (
              <>
                <div className="text-lg font-extrabold truncate leading-tight">{flash.text}</div>
                {flash.sub && <div className="text-sm text-muted-foreground truncate">{flash.sub}</div>}
              </>
            ) : (
              <>
                <div className="text-base font-bold text-slate-700">Escaneá los paquetes que salen</div>
                <div className="text-sm text-muted-foreground">Cada lectura suma a la tabla</div>
              </>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {lastScan && (
              <button onClick={undoLast} className="h-9 px-3 rounded-xl border bg-white text-xs font-semibold inline-flex items-center gap-1 hover:bg-slate-50">
                <Undo2 className="h-4 w-4" /> Deshacer
              </button>
            )}
            <ScanLine className="h-6 w-6 text-slate-300 hidden sm:block" />
          </div>
        </div>

        {/* Carga manual */}
        <form onSubmit={handleManualAdd} className="flex items-end gap-2 bg-white border rounded-2xl p-3">
          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground">¿Falta etiqueta? Cargar manual</label>
            <Input value={manualRef} onChange={e => setManualRef(e.target.value)} placeholder="Referencia…" className="mt-1" />
          </div>
          <div className="w-20">
            <label className="text-xs font-medium text-muted-foreground">Cant.</label>
            <Input type="number" min={1} value={manualQty || ''} onChange={e => setManualQty(+e.target.value)} className="mt-1 text-center font-mono" />
          </div>
          <button type="submit" className="h-10 px-4 rounded-xl border font-semibold text-sm inline-flex items-center gap-1 hover:bg-slate-50">
            <Plus className="h-4 w-4" /> Sumar
          </button>
        </form>

        {/* Tabla de lo despachado — SIN precios */}
        {order.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-14 border border-dashed rounded-2xl bg-white">
            Escaneá el primer paquete para empezar el despacho.
          </div>
        ) : (
          <div className="space-y-2">
            {order.map(key => {
              const line = scanned[key]; if (!line) return null;
              const prod = productByRef.get(key);
              const loc = (prod?.location ?? '').trim();
              return (
                <div key={key} className={`bg-white rounded-2xl border p-3.5 flex items-center gap-3 transition-shadow ${!prod ? 'border-amber-300 bg-amber-50/40' : ''} ${key === lastKey ? (prod ? 'ring-2 ring-offset-1 ring-emerald-400' : 'ring-2 ring-offset-1 ring-amber-400') : ''}`}>
                  <div className="min-w-0 flex-1">
                    <div className="font-bold text-base truncate flex items-center gap-2">
                      {line.reference}
                      {loc && <span className="text-[10px] font-bold border rounded px-1.5 py-0.5 inline-flex items-center gap-0.5"><MapPin className="h-3 w-3" />{loc}</span>}
                    </div>
                    <div className={`text-xs truncate ${prod ? 'text-muted-foreground' : 'text-amber-700 font-medium'}`}>
                      {prod ? (prod.name || 'Sin descripción') : 'No está en inventario'}
                    </div>
                  </div>
                  <div className="text-2xl font-extrabold tabular-nums text-slate-800 leading-none">{line.quantity}</div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => adjust(key, -1)} className="h-10 w-10 rounded-xl border flex items-center justify-center active:scale-95 hover:bg-slate-50" aria-label="Restar uno"><Minus className="h-4 w-4" /></button>
                    <button onClick={() => adjust(key, +1)} className="h-10 w-10 rounded-xl border flex items-center justify-center active:scale-95 hover:bg-slate-50" aria-label="Sumar uno"><Plus className="h-4 w-4" /></button>
                    <button onClick={() => removeKey(key)} className="h-10 w-10 rounded-xl border flex items-center justify-center text-muted-foreground hover:text-red-500 active:scale-95" aria-label="Quitar"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Acciones */}
        <div className="flex items-center gap-3 pt-1">
          <button onClick={cancelDespacho} className="h-12 px-4 rounded-2xl border font-medium text-sm text-muted-foreground hover:bg-slate-50">
            Cancelar
          </button>
          <div className="text-sm text-muted-foreground flex-1">
            <span className="font-semibold text-foreground tabular-nums">{order.length}</span> ref · <span className="font-semibold text-foreground tabular-nums">{totalUnits}</span> und
          </div>
          <button
            onClick={() => setShowConfirm(true)}
            disabled={saving || order.length === 0}
            className="h-12 px-6 rounded-2xl bg-green-600 hover:bg-green-700 text-white font-bold flex items-center gap-2 active:scale-[0.98] disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <FileCheck className="h-5 w-5" />}
            Generar remisión
          </button>
        </div>

        {/* Pantalla de revisión antes de generar (acción irreversible) */}
        <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader><DialogTitle className="text-base">Revisar despacho</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Cliente: </span>
                <span className="font-semibold">{beneficiary || 'Sin cliente'}</span>
              </div>
              <div className="flex gap-3">
                <div className="flex-1 bg-slate-50 border rounded-xl px-3 py-2 text-center">
                  <div className="text-xl font-extrabold tabular-nums">{order.length}</div>
                  <div className="text-xs text-muted-foreground">referencias</div>
                </div>
                <div className="flex-1 bg-slate-50 border rounded-xl px-3 py-2 text-center">
                  <div className="text-xl font-extrabold tabular-nums">{totalUnits}</div>
                  <div className="text-xs text-muted-foreground">unidades</div>
                </div>
              </div>
              <div className="max-h-48 overflow-auto rounded-xl border divide-y">
                {order.map(k => {
                  const line = scanned[k]; if (!line) return null;
                  return (
                    <div key={k} className="flex items-center justify-between px-3 py-1.5 text-sm">
                      <span className="font-medium truncate">{line.reference}</span>
                      <span className="font-mono tabular-nums">{line.quantity}</span>
                    </div>
                  );
                })}
              </div>
              <button
                onClick={() => { setShowConfirm(false); generarRemision(); }}
                disabled={saving}
                className="w-full h-11 rounded-xl bg-green-600 hover:bg-green-700 text-white font-bold inline-flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <FileCheck className="h-5 w-5" /> Generar remisión e imprimir
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
