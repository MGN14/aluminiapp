import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  Loader2,
  Package,
  Plus,
  Ruler,
  Save,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useInventoryBySystem } from '@/hooks/useCatalogComponents';
import { useInventoryByIds, useProductTemplates } from '@/hooks/useProductTemplates';
import {
  computeDespiece,
  FORMULA_LABELS,
  TIPO_LABELS,
  type ProductTemplate,
  type TemplateFormula,
  type TemplatePiece,
  type TemplateTipo,
} from '@/types/productTemplate';
import ProductDrawing from './ProductDrawing';

function formatCurrency(value: number) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
  }).format(value);
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

const TIPOS: TemplateTipo[] = [
  'ventana_corrediza',
  'ventana_fija',
  'ventana_batiente',
  'puerta_corrediza',
  'puerta_batiente',
];

const FORMULAS: TemplateFormula[] = ['ancho', 'alto', 'perimetro', 'area', 'fijo'];

// ════════════════════════════════════════════════════════════════════════════
// Panel inline de edición de una plantilla: datos + piezas + preview vivo
// ════════════════════════════════════════════════════════════════════════════
function TemplatePanel({ tpl }: { tpl: ProductTemplate }) {
  const { toast } = useToast();
  const { updateOne } = useProductTemplates();

  // ── Datos (dirty-save) ──
  const [tipo, setTipo] = useState<TemplateTipo>(tpl.tipo);
  const [naves, setNaves] = useState(String(tpl.naves));
  const [apertura, setApertura] = useState(tpl.apertura);
  const [system, setSystem] = useState(tpl.system ?? '');
  const [color, setColor] = useState(tpl.color ?? '');
  const [margen, setMargen] = useState(String(tpl.margen_pct));
  const [desperdicio, setDesperdicio] = useState(String(tpl.desperdicio_pct));
  const [description, setDescription] = useState(tpl.description ?? '');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setTipo(tpl.tipo);
    setNaves(String(tpl.naves));
    setApertura(tpl.apertura);
    setSystem(tpl.system ?? '');
    setColor(tpl.color ?? '');
    setMargen(String(tpl.margen_pct));
    setDesperdicio(String(tpl.desperdicio_pct));
    setDescription(tpl.description ?? '');
    setDirty(false);
  }, [tpl.id]);

  // ── Dimensiones de prueba para validar fórmulas ──
  const [testW, setTestW] = useState('1.2');
  const [testH, setTestH] = useState('1.5');
  const testWNum = Number(testW) || 0;
  const testHNum = Number(testH) || 0;

  // ── Piezas ──
  const [filterAll, setFilterAll] = useState(!tpl.system);
  const { data: inventory = [], isLoading: invLoading } = useInventoryBySystem(
    filterAll ? undefined : system || undefined,
  );
  const pieceProductIds = useMemo(() => tpl.piezas.map((p) => p.product_id), [tpl.piezas]);
  const { byId: productsById } = useInventoryByIds(pieceProductIds);

  const [pickedProductId, setPickedProductId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newFormula, setNewFormula] = useState<TemplateFormula>('ancho');
  const [newMult, setNewMult] = useState('1');

  const navesNum = Math.max(1, parseInt(naves, 10) || 1);
  const margenNum = Number(margen) || 0;
  const desperdicioNum = Number(desperdicio) || 0;

  const despiece = useMemo(
    () =>
      computeDespiece(
        { piezas: tpl.piezas, margen_pct: margenNum, desperdicio_pct: desperdicioNum },
        testWNum,
        testHNum,
        productsById,
      ),
    [tpl.piezas, margenNum, desperdicioNum, testWNum, testHNum, productsById],
  );

  const savePiezas = async (piezas: TemplatePiece[]) => {
    try {
      await updateOne.mutateAsync({ id: tpl.id, patch: { piezas } });
    } catch (e: any) {
      toast({ title: 'Error guardando piezas', description: e?.message, variant: 'destructive' });
    }
  };

  const handleAddPiece = async () => {
    if (!pickedProductId) {
      toast({ title: 'Elegí un producto del inventario', variant: 'destructive' });
      return;
    }
    const mult = Number(newMult);
    if (!Number.isFinite(mult) || mult <= 0) {
      toast({ title: 'Multiplicador inválido', variant: 'destructive' });
      return;
    }
    const product = inventory.find((p) => p.id === pickedProductId);
    const piece: TemplatePiece = {
      key: uid(),
      product_id: pickedProductId,
      label: newLabel.trim() || product?.name || 'Pieza',
      formula: newFormula,
      multiplicador: mult,
    };
    await savePiezas([...tpl.piezas, piece]);
    setPickedProductId('');
    setNewLabel('');
    setNewMult('1');
  };

  const handlePatchPiece = async (key: string, patch: Partial<TemplatePiece>) => {
    await savePiezas(tpl.piezas.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  };

  const handleRemovePiece = async (key: string) => {
    await savePiezas(tpl.piezas.filter((p) => p.key !== key));
  };

  const handleSaveDatos = async () => {
    const m = Number(margen);
    const d = Number(desperdicio);
    if (!Number.isFinite(m) || m < 0 || !Number.isFinite(d) || d < 0) {
      toast({ title: 'Margen o desperdicio inválido', variant: 'destructive' });
      return;
    }
    try {
      await updateOne.mutateAsync({
        id: tpl.id,
        patch: {
          tipo,
          naves: navesNum,
          apertura,
          system: system || null,
          color: color || null,
          margen_pct: m,
          desperdicio_pct: d,
          description: description || null,
        },
      });
      setDirty(false);
      toast({ title: 'Plantilla actualizada' });
    } catch (e: any) {
      toast({ title: 'Error', description: e?.message, variant: 'destructive' });
    }
  };

  const esBatiente = tipo === 'ventana_batiente' || tipo === 'puerta_batiente';
  const usedIds = useMemo(() => new Set(pieceProductIds), [pieceProductIds]);
  const pickable = useMemo(() => inventory.filter((p) => !usedIds.has(p.id)), [inventory, usedIds]);

  return (
    <div className="space-y-4 pt-2">
      {/* ════════ Datos + preview ════════ */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Tipo</Label>
              <Select
                value={tipo}
                onValueChange={(v) => {
                  setTipo(v as TemplateTipo);
                  setDirty(true);
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIPOS.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIPO_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {tipo !== 'ventana_fija' && (
              <div className="space-y-1">
                <Label className="text-xs">Naves / hojas</Label>
                <Input
                  type="number"
                  min={1}
                  max={6}
                  step={1}
                  value={naves}
                  onChange={(e) => {
                    setNaves(e.target.value);
                    setDirty(true);
                  }}
                  className="h-8 text-xs"
                />
              </div>
            )}
            {esBatiente && navesNum === 1 && (
              <div className="space-y-1">
                <Label className="text-xs">Bisagras</Label>
                <Select
                  value={apertura}
                  onValueChange={(v) => {
                    setApertura(v as typeof apertura);
                    setDirty(true);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="izquierda">Izquierda</SelectItem>
                    <SelectItem value="derecha">Derecha</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1">
              <Label className="text-xs">Sistema</Label>
              <Input
                placeholder="744"
                value={system}
                onChange={(e) => {
                  setSystem(e.target.value);
                  setDirty(true);
                }}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Color</Label>
              <Input
                placeholder="Mate"
                value={color}
                onChange={(e) => {
                  setColor(e.target.value);
                  setDirty(true);
                }}
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Margen %</Label>
              <Input
                type="number"
                min={0}
                step={1}
                value={margen}
                onChange={(e) => {
                  setMargen(e.target.value);
                  setDirty(true);
                }}
                className="h-8 text-xs"
              />
              <p className="text-[9px] text-muted-foreground">Precio = costo × (1 + margen)</p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Desperdicio %</Label>
              <Input
                type="number"
                min={0}
                step={1}
                value={desperdicio}
                onChange={(e) => {
                  setDesperdicio(e.target.value);
                  setDirty(true);
                }}
                className="h-8 text-xs"
              />
              <p className="text-[9px] text-muted-foreground">
                Sobre perfiles y vidrio, no herrajes
              </p>
            </div>
            <div className="col-span-2 space-y-1">
              <Label className="text-xs">Descripción</Label>
              <Input
                placeholder="Ventana corrediza línea 744, 2 naves"
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setDirty(true);
                }}
                className="h-8 text-xs"
              />
            </div>
          </div>
          <div className="flex justify-end pt-1 border-t border-border">
            <Button size="sm" onClick={handleSaveDatos} disabled={!dirty || updateOne.isPending}>
              {updateOne.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <Save className="h-3.5 w-3.5 mr-1.5" />
              )}
              Guardar datos
            </Button>
          </div>
        </div>

        {/* Preview con dims de prueba */}
        <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Ruler className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium">Probar con</span>
            <Input
              type="number"
              step="0.1"
              min={0.1}
              value={testW}
              onChange={(e) => setTestW(e.target.value)}
              className="h-7 w-16 text-xs"
            />
            <span className="text-xs text-muted-foreground">×</span>
            <Input
              type="number"
              step="0.1"
              min={0.1}
              value={testH}
              onChange={(e) => setTestH(e.target.value)}
              className="h-7 w-16 text-xs"
            />
            <span className="text-xs text-muted-foreground">m</span>
          </div>
          <ProductDrawing
            tipo={tipo}
            naves={navesNum}
            apertura={apertura}
            widthM={testWNum}
            heightM={testHNum}
            showDims
            className="h-44 flex items-center justify-center"
          />
        </div>
      </div>

      {/* ════════ Piezas ════════ */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Piezas del despiece</span>
          <span className="text-[11px] text-muted-foreground ml-auto">
            qty = fórmula(ancho, alto) × multiplicador · Ej: jamba = alto × 2
          </span>
        </div>

        {tpl.piezas.length === 0 ? (
          <div className="rounded-md border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
            Sin piezas aún. Agregá perfiles, vidrio y herrajes desde tu inventario abajo.
          </div>
        ) : (
          <div className="space-y-2">
            {despiece.lines.map((l) => (
              <div
                key={l.piece.key}
                className="rounded-md border border-border p-2.5 grid grid-cols-2 sm:grid-cols-[1.4fr_1fr_90px_110px_110px_40px] gap-2 items-center"
              >
                <div className="space-y-0.5 col-span-2 sm:col-span-1">
                  <Input
                    defaultValue={l.piece.label}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== l.piece.label) handlePatchPiece(l.piece.key, { label: v });
                    }}
                    className="h-8 text-xs font-medium"
                  />
                  <div className="text-[10px] text-muted-foreground px-1">
                    {l.product ? (
                      <>
                        {l.product.reference} · {l.product.name} ·{' '}
                        {formatCurrency(l.unitCost)}/{l.product.unit || 'und'}
                      </>
                    ) : (
                      <span className="text-destructive inline-flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        Producto eliminado del inventario
                      </span>
                    )}
                  </div>
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px]">Fórmula</Label>
                  <Select
                    value={l.piece.formula}
                    onValueChange={(v) =>
                      handlePatchPiece(l.piece.key, { formula: v as TemplateFormula })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FORMULAS.map((f) => (
                        <SelectItem key={f} value={f}>
                          {FORMULA_LABELS[f]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px]">× Mult.</Label>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    defaultValue={String(l.piece.multiplicador)}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v > 0 && v !== l.piece.multiplicador) {
                        handlePatchPiece(l.piece.key, { multiplicador: v });
                      }
                    }}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px]">
                    Cant @ {testW}×{testH}
                  </Label>
                  <div className="h-8 flex items-center px-2 rounded-md bg-muted/40 border border-border tabular-nums text-xs">
                    {l.qty} {l.unidad}
                  </div>
                </div>
                <div className="space-y-0.5">
                  <Label className="text-[10px]">Costo línea</Label>
                  <div className="h-8 flex items-center px-2 rounded-md bg-muted/40 border border-border tabular-nums text-xs">
                    {formatCurrency(l.lineCost)}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemovePiece(l.piece.key)}
                  className="text-muted-foreground hover:text-destructive justify-center"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}

            {/* Resumen de costeo @ dims de prueba */}
            <div className="rounded-md border border-border bg-muted/30 p-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
              <div>
                <div className="text-muted-foreground">Material</div>
                <div className="font-medium tabular-nums">
                  {formatCurrency(despiece.materialCost)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">+ Desperdicio {desperdicioNum}%</div>
                <div className="font-medium tabular-nums">
                  {formatCurrency(despiece.wasteAmount)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">= Costo</div>
                <div className="font-medium tabular-nums">{formatCurrency(despiece.costTotal)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Precio (+{margenNum}%)</div>
                <div className="font-semibold tabular-nums text-primary">
                  {formatCurrency(despiece.priceUnit)}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Precio /m²</div>
                <div className="font-medium tabular-nums">
                  {formatCurrency(despiece.pricePerM2)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ════════ Agregar pieza ════════ */}
      <div className="rounded-md border border-border bg-muted/20 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium">Agregar pieza desde inventario</div>
          <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={filterAll}
              onChange={(e) => setFilterAll(e.target.checked)}
            />
            Mostrar todos los productos{system ? ` (no solo del sistema "${system}")` : ''}
          </label>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
          <div className="sm:col-span-4 space-y-1">
            <Label className="text-[10px]">Producto del inventario</Label>
            <Select value={pickedProductId} onValueChange={setPickedProductId}>
              <SelectTrigger className="h-9">
                <SelectValue
                  placeholder={
                    invLoading
                      ? 'Cargando…'
                      : pickable.length === 0
                        ? 'No hay productos disponibles'
                        : 'Elegir producto'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {pickable.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {p.reference}
                      </span>
                      <span>{p.name}</span>
                      {p.system && (
                        <span className="text-[9px] text-muted-foreground">[{p.system}]</span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-3 space-y-1">
            <Label className="text-[10px]">Nombre de la pieza</Label>
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Riel superior"
              className="h-9"
            />
          </div>
          <div className="sm:col-span-3 space-y-1">
            <Label className="text-[10px]">Fórmula</Label>
            <Select value={newFormula} onValueChange={(v) => setNewFormula(v as TemplateFormula)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMULAS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {FORMULA_LABELS[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2 space-y-1">
            <Label className="text-[10px]">× Multiplicador</Label>
            <Input
              type="number"
              step="0.01"
              min={0}
              value={newMult}
              onChange={(e) => setNewMult(e.target.value)}
              className="h-9"
            />
          </div>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Ejemplos: riel superior = Ancho × 1 · jamba = Alto × 2 · traslapo = Alto × {navesNum} ·
          vidrio = Área × 1 · rodachinas = Fijo × 4.
        </p>
        <Button
          type="button"
          size="sm"
          onClick={handleAddPiece}
          disabled={updateOne.isPending || !pickedProductId}
        >
          {updateOne.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
          ) : (
            <Plus className="h-4 w-4 mr-1.5" />
          )}
          Agregar pieza
        </Button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Vista completa: lista + crear plantilla
// ════════════════════════════════════════════════════════════════════════════
export default function TemplatesConfigView() {
  const { toast } = useToast();
  const { data, isLoading, createOne, updateOne, deleteOne } = useProductTemplates();
  const [openIds, setOpenIds] = useState<string[]>([]);

  const [name, setName] = useState('');
  const [tipo, setTipo] = useState<TemplateTipo>('ventana_corrediza');
  const [naves, setNaves] = useState('2');

  const handleCreate = async () => {
    if (!name.trim()) {
      toast({ title: 'Poné un nombre a la plantilla', variant: 'destructive' });
      return;
    }
    try {
      const created = await createOne.mutateAsync({
        name: name.trim(),
        tipo,
        naves: Math.max(1, parseInt(naves, 10) || 1),
      });
      setName('');
      toast({ title: 'Plantilla creada — configurá sus piezas abajo' });
      setOpenIds((prev) => [...prev, created.id]);
    } catch (e: any) {
      const msg = e?.message?.includes('duplicate')
        ? 'Ya existe una plantilla con ese nombre.'
        : e?.message || 'No se pudo crear.';
      toast({ title: 'Error', description: msg, variant: 'destructive' });
    }
  };

  const handleToggleActive = async (tpl: ProductTemplate, e?: React.MouseEvent) => {
    e?.stopPropagation();
    try {
      await updateOne.mutateAsync({ id: tpl.id, patch: { active: !tpl.active } });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message, variant: 'destructive' });
    }
  };

  const handleDelete = async (tpl: ProductTemplate, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!confirm(`¿Eliminar la plantilla "${tpl.name}"? Las cotizaciones existentes conservan su despiece.`))
      return;
    try {
      await deleteOne.mutateAsync(tpl.id);
      toast({ title: 'Plantilla eliminada' });
    } catch (err: any) {
      toast({ title: 'Error', description: err?.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Plantillas paramétricas tipo RA Workshop: definí las piezas una vez con fórmulas por
        dimensión y cotizá cualquier medida en segundos. El costo sale en vivo de tu inventario;
        el precio aplica el margen de la plantilla.
      </p>

      {/* Crear */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-3">
        <div className="text-sm font-medium">Nueva plantilla</div>
        <div className="grid grid-cols-1 sm:grid-cols-[2fr_1.4fr_100px_auto] gap-2 items-end">
          <div className="space-y-1">
            <Label className="text-xs">Nombre *</Label>
            <Input
              placeholder="Ventana corrediza 744 — 2 naves"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as TemplateTipo)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIPOS.map((t) => (
                  <SelectItem key={t} value={t}>
                    {TIPO_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Naves</Label>
            <Input
              type="number"
              min={1}
              max={6}
              step={1}
              value={naves}
              onChange={(e) => setNaves(e.target.value)}
              disabled={tipo === 'ventana_fija'}
            />
          </div>
          <Button onClick={handleCreate} disabled={createOne.isPending}>
            {createOne.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
            ) : (
              <Plus className="h-4 w-4 mr-1.5" />
            )}
            Crear
          </Button>
        </div>
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : data.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center">
          <Ruler className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="text-sm font-medium">Sin plantillas aún</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Creá la primera arriba (ej: "Ventana corrediza 744 — 2 naves") y cargale sus piezas.
          </p>
        </div>
      ) : (
        <Accordion type="multiple" value={openIds} onValueChange={setOpenIds} className="space-y-2">
          {data.map((tpl) => {
            const sinPiezas = tpl.piezas.length === 0;
            return (
              <AccordionItem
                key={tpl.id}
                value={tpl.id}
                className={`rounded-lg border overflow-hidden ${
                  sinPiezas
                    ? 'border-amber-300 bg-amber-50/40 dark:bg-amber-950/20'
                    : 'border-border bg-card'
                }`}
              >
                <AccordionTrigger className="px-4 py-3 hover:no-underline [&[data-state=open]>div>svg.chevron]:rotate-180">
                  <div className="flex-1 flex items-center gap-3 flex-wrap mr-2">
                    <div className="h-12 w-14 shrink-0 hidden sm:block">
                      <ProductDrawing
                        tipo={tpl.tipo}
                        naves={tpl.naves}
                        apertura={tpl.apertura}
                        widthM={1.2}
                        heightM={1.2}
                        showDims={false}
                        className="h-full w-full"
                      />
                    </div>
                    <div
                      className={`flex-1 min-w-[150px] text-left ${
                        !tpl.active ? 'text-muted-foreground line-through' : ''
                      }`}
                    >
                      <div className="text-sm font-medium">{tpl.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {TIPO_LABELS[tpl.tipo]}
                        {tpl.tipo !== 'ventana_fija' ? ` · ${tpl.naves} naves` : ''}
                        {tpl.system ? ` · Sistema ${tpl.system}` : ''}
                        {tpl.color ? ` · ${tpl.color}` : ''}
                      </div>
                    </div>
                    <div className="text-xs text-right min-w-[110px]">
                      {sinPiezas ? (
                        <span className="text-amber-700 dark:text-amber-400 font-medium">
                          Sin piezas
                        </span>
                      ) : (
                        <>
                          <Badge variant="outline" className="text-[10px]">
                            {tpl.piezas.length} piezas
                          </Badge>
                          <div className="text-[10px] text-muted-foreground mt-0.5">
                            Margen {Number(tpl.margen_pct)}%
                          </div>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      <Switch checked={tpl.active} onCheckedChange={() => handleToggleActive(tpl)} />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => handleDelete(tpl, e)}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <ChevronDown className="chevron h-4 w-4 text-muted-foreground transition-transform" />
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4 border-t border-border">
                  <TemplatePanel tpl={tpl} />
                </AccordionContent>
              </AccordionItem>
            );
          })}
        </Accordion>
      )}
    </div>
  );
}
