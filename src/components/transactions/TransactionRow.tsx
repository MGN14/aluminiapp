import { useEffect, useRef, useMemo } from 'react';
import { Transaction, Category, Responsible, SimpleTransactionType, SIMPLE_TYPES, MOVEMENT_NATURES } from '@/types/transaction';
import { parseLocalDate } from '@/lib/dateUtils';
import { cn } from '@/lib/utils';
import { TableCell, TableRow } from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Eye, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTransactionEdit } from '@/hooks/useTransactionEdit';
import SaveStatusIndicator from './SaveStatusIndicator';
import { SearchableSelect } from './SearchableSelect';
import CardDescriptionEditor from './CardDescriptionEditor';
import InvoiceSelector, { InvoiceTag } from './InvoiceSelector';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { classifyBucket, bucketWantsInvoice } from '@/lib/txBucket';
import { toast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { useConciliacionHistorial } from '@/hooks/useConciliacionHistorial';
import { useBankInvoiceMatches } from '@/hooks/useBankInvoiceMatches';
import { useQuery } from '@tanstack/react-query';
import { fetchDatosVentasProbable, sugerirClienteParaPago } from '@/lib/ventasProbable';
import {
  sugerirBeneficiario, sugerirCategoria, alertaCategoriaInusual, alertaMontoInusual,
} from '@/lib/conciliacionHistorial';
import {
  type CardDescriptionRule,
  findMatchingCardRule,
  isSyntheticCardDescription,
} from '@/hooks/useCardDescriptionRules';

interface TransactionRowProps {
  transaction: Transaction;
  categories: Category[];
  responsibles: Responsible[];
  onViewDetail: (transaction: Transaction) => void;
  onCategoryAdded?: () => void;
  onResponsibleAdded?: () => void;
  onTransactionUpdated?: (transaction: Transaction) => void;
  /** Solo tarjeta de crédito: el CSV no trae comercio ("Compra TC *2047"),
   *  así que la descripción se puede reemplazar desde la fila. */
  canEditDescription?: boolean;
  /** Reglas inversas de tarjeta (cat+beneficiario → descripción). Solo se
   *  evalúan cuando canEditDescription y la descripción sigue sintética. */
  cardDescriptionRules?: CardDescriptionRule[];
}

function formatCurrency(value: number | null) {
  if (value === null || value === undefined || value === 0) return '—';
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export default function TransactionRow({
  transaction,
  categories,
  responsibles,
  onViewDetail,
  onCategoryAdded,
  onResponsibleAdded,
  onTransactionUpdated,
  canEditDescription,
  cardDescriptionRules,
}: TransactionRowProps) {
  const { user } = useAuth();
  
  const { status, errorMessage, updateField, localTransaction } = useTransactionEdit(transaction, {
    debounceMs: 600,
  });

  // Notify parent of optimistic updates so filters (e.g. pending) react instantly
  const prevResponsibleRef = useRef(transaction.responsible_id);
  const prevCategoryRef = useRef(transaction.category_id);
  const prevTypeRef = useRef(transaction.type);
  const prevDescriptionRef = useRef(transaction.description);

  useEffect(() => {
    const changed =
      localTransaction.responsible_id !== prevResponsibleRef.current ||
      localTransaction.category_id !== prevCategoryRef.current ||
      localTransaction.type !== prevTypeRef.current ||
      localTransaction.description !== prevDescriptionRef.current;

    if (changed) {
      prevResponsibleRef.current = localTransaction.responsible_id;
      prevCategoryRef.current = localTransaction.category_id;
      prevTypeRef.current = localTransaction.type;
      prevDescriptionRef.current = localTransaction.description;
      onTransactionUpdated?.(localTransaction);
    }
  }, [localTransaction.responsible_id, localTransaction.category_id, localTransaction.type, localTransaction.description, onTransactionUpdated, localTransaction]);

  /**
   * Regla inversa de tarjeta: si esta fila es de tarjeta, su descripción sigue
   * siendo la sintética ("Compra TC *2047") y la combinación resultante de
   * categoría+beneficiario matchea una regla activa, agregamos la descripción
   * de la regla al mismo update (un solo guardado, un solo render).
   */
  const withCardDescription = (updates: Partial<Transaction>): Partial<Transaction> => {
    if (!canEditDescription || !cardDescriptionRules?.length) return updates;
    if (!isSyntheticCardDescription(localTransaction.description)) return updates;
    const merged = { ...localTransaction, ...updates };
    const rule = findMatchingCardRule(cardDescriptionRules, merged.category_id, merged.responsible_id);
    return rule ? { ...updates, description: rule.description } : updates;
  };

  const handleCategoryChange = (categoryId: string | null) => {
    updateField(withCardDescription({ category_id: categoryId, category: null }));
    // Aviso (sin bloquear) si contradice el histórico de esta descripción:
    // ≥4 casos previos y ≥75% en otra categoría. Un clic lo corrige.
    if (historial && categoryId && !descExcluida) {
      const a = alertaCategoriaInusual(historial, localTransaction.description, categoryId);
      if (a) {
        const dominante = categories.find(c => c.id === a.dominanteId);
        if (dominante) {
          toast({
            title: 'Distinto a como lo venías clasificando',
            description: `«${localTransaction.description}» fue ${dominante.name} ${a.veces} de ${a.total} veces.`,
            duration: 9000,
            action: (
              <ToastAction altText={`Usar ${dominante.name}`}
                onClick={() => updateField(withCardDescription({ category_id: a.dominanteId, category: null }))}>
                Usar {dominante.name}
              </ToastAction>
            ),
          });
        }
      }
    }
  };

  const handleResponsibleChange = (value: string | null) => {
    updateField(withCardDescription({ responsible_id: value }));
    // Auto-assign N/A tag when responsible is "Banco"
    const selectedResp = responsibles.find(r => r.id === value);
    if (selectedResp && selectedResp.name.toLowerCase() === 'banco' && !derivedTags.includes('na') && !derivedInvoiceId) {
      handleInvoiceChange(null, [...derivedTags, 'na']);
    }
    // Aviso si el monto se sale del rango histórico de ese beneficiario en
    // esa categoría (≥4 pagos previos, 30% fuera del rango). Solo informa.
    if (historial && value) {
      const a = alertaMontoInusual(historial, localTransaction.category_id, value, localTransaction.amount);
      if (a && selectedResp) {
        toast({
          title: 'Monto fuera de lo habitual',
          description: Number(localTransaction.amount ?? 0) > 0
            ? `De ${selectedResp.name} venías recibiendo ${a.texto} (${a.n} ingresos). Este es distinto — revisá que no sea otro cliente.`
            : `A ${selectedResp.name} le venías pagando ${a.texto} (${a.n} pagos). Este movimiento es distinto — revisá que no sea otro beneficiario.`,
          duration: 9000,
        });
      }
    }
  };

  const handleTypeChange = (type: SimpleTransactionType) => {
    updateField({ type });
  };

  const handleNatureChange = (nature: string) => {
    updateField({ movement_nature: nature as Transaction['movement_nature'] });
  };

  const handleInvoiceChange = async (
    newInvoiceId: string | null,
    newTags: InvoiceTag[],
    autoMatches?: import('./InvoiceSelector').AutoMatchResult[],
    creditLink?: import('./InvoiceSelector').CreditLinkInfo,
  ) => {
    // Build notes from tags
    const tagMarkers: Record<InvoiceTag, string> = {
      na: '[N/A - Sin factura]',
      iva_favor: '[IVA a favor - Pago DIAN]',
      retefuente: '[Retefuente - Sin factura]',
      anticipo: '[Anticipo]',
    };

    // Clean existing markers from notes
    let cleanNotes = (localTransaction.notes || '')
      .replace(/\[N\/A - Sin factura\]/g, '')
      .replace(/\[IVA a favor - Pago DIAN\]/g, '')
      .replace(/\[Retefuente - Sin factura\]/g, '')
      .replace(/\[Anticipo\]/g, '')
      .replace(/\[Crédito - [^\]]+\]/g, '')
      .trim();

    // Add new markers
    const markers = newTags.map(t => tagMarkers[t]).join('');
    const creditMarker = creditLink ? `[Crédito - ${creditLink.creditName}]` : '';
    const finalNotes = [markers, creditMarker, cleanNotes].filter(Boolean).join('') || null;

    // Si vino un creditLink, también pisamos categoría/responsable con los defaults del crédito
    const fieldUpdate: Record<string, unknown> = {
      invoice_id: newInvoiceId,
      notes: finalNotes,
      has_retefuente: newTags.includes('retefuente'),
    };
    if (creditLink) {
      if (creditLink.defaultCategoryId) fieldUpdate.category_id = creditLink.defaultCategoryId;
      if (creditLink.defaultResponsibleId) fieldUpdate.responsible_id = creditLink.defaultResponsibleId;
    }
    updateField(fieldUpdate);

    // Create auto-match records for excess distribution
    if (autoMatches?.length && user) {
      for (const match of autoMatches) {
        await supabase
          .from('invoice_transaction_matches')
          .insert({
            invoice_id: match.invoiceId,
            transaction_id: localTransaction.id,
            user_id: user.id,
            matched_amount: match.matchedAmount,
            match_type: 'manual',
          });
      }
    }

    // Vincular pago a crédito: insert credit_payment + actualizar status si saldó
    if (creditLink && user) {
      try {
        const { error: cpErr } = await (supabase.from('credit_payments' as never) as any)
          .insert({
            user_id: user.id,
            credit_id: creditLink.creditId,
            payment_date: creditLink.paymentDate,
            amount_paid: creditLink.amountPaid,
            principal_paid: creditLink.principalPaid,
            interest_paid: creditLink.interestPaid,
            is_extra: false,
            notes: `Conciliado desde extracto`,
            transaction_id: localTransaction.id,
          });
        if (cpErr) throw cpErr;

        if (creditLink.newBalance <= 0.5) {
          await (supabase.from('credits' as never) as any)
            .update({ status: 'paid' })
            .eq('id', creditLink.creditId);
        }
      } catch (err) {
        console.error('Error linking credit:', err);
      }
    }
  };

  const handleAddCategory = async (name: string): Promise<string | null> => {
    if (!user) return null;
    
    const { data, error } = await supabase
      .from('categories')
      .insert({ user_id: user.id, name, sort_order: categories.length })
      .select('id')
      .single();
    
    if (error) {
      console.error('Error adding category:', error);
      return null;
    }
    
    onCategoryAdded?.();
    return data.id;
  };

  const handleAddResponsible = async (name: string): Promise<string | null> => {
    if (!user) return null;
    
    const { data, error } = await supabase
      .from('responsibles')
      .insert({ user_id: user.id, name })
      .select('id')
      .single();
    
    if (error) {
      console.error('Error adding responsible:', error);
      return null;
    }
    
    onResponsibleAdded?.();
    return data.id;
  };

  const amountColor = (localTransaction.amount ?? 0) >= 0 ? 'text-success' : 'text-destructive';
  const isReconciled = !!localTransaction.responsible_id;

  // Historial de conciliación (cacheado, compartido entre todas las filas):
  // alimenta las sugerencias de beneficiario/categoría y las alertas.
  const { historial, esExcluida } = useConciliacionHistorial(true);

  // Sugerencia del motor banco→factura para ESTE ingreso (confianza 50-79:
  // las ≥80 se aplican solas). Traída a la fila para que se vea DONDE se
  // trabaja, no en un reporte aparte (Nico 2026-08-07).
  const { pending: matchesPendientes, confirm: confirmarMatch, reject: rechazarMatch } = useBankInvoiceMatches();
  const sugerenciaFactura = useMemo(() => {
    if (localTransaction.invoice_id || Number(localTransaction.amount ?? 0) <= 0) return null;
    return matchesPendientes.find((s) => s.transaction_id === localTransaction.id) ?? null;
  }, [matchesPendientes, localTransaction.invoice_id, localTransaction.amount, localTransaction.id]);

  // Fases 4+5: cuando NINGUNA factura calza sola, sugerir el CLIENTE por
  // cartera + combos de facturas + montos habituales + tiempos de pago.
  // Query compartida entre todas las filas (una sola carga, cacheada).
  const esIngresoSinDuenio = Number(localTransaction.amount ?? 0) > 0
    && !localTransaction.responsible_id && !localTransaction.invoice_id;
  const { data: datosVentas } = useQuery({
    queryKey: ['conciliacion', 'ventas-probable'],
    queryFn: fetchDatosVentasProbable,
    enabled: esIngresoSinDuenio,
    staleTime: 5 * 60_000,
  });
  const sugerenciaCliente = useMemo(() => {
    // El motor por factura tiene prioridad: si hay sugerencia puntual, esa manda.
    if (!esIngresoSinDuenio || !datosVentas || sugerenciaFactura) return null;
    return sugerirClienteParaPago(datosVentas, {
      amount: Number(localTransaction.amount ?? 0),
      date: localTransaction.date,
      description: localTransaction.description,
    });
  }, [esIngresoSinDuenio, datosVentas, sugerenciaFactura, localTransaction.amount, localTransaction.date, localTransaction.description]);

  /** Acepta la sugerencia de cliente: beneficiario + Ventas; si trae combo
   *  de facturas (Fase 5), las vincula todas (la primera en invoice_id, el
   *  resto por invoice_transaction_matches, mismo camino que el selector). */
  async function aceptarSugerenciaCliente() {
    if (!sugerenciaCliente) return;
    const ventas = categories.find((c) => c.name.toLowerCase().includes('venta'))?.id;
    updateField(withCardDescription({
      responsible_id: sugerenciaCliente.responsibleId,
      ...(localTransaction.category_id ? {} : ventas ? { category_id: ventas } : {}),
    }));
    if (sugerenciaCliente.combo) {
      const [primera, ...resto] = sugerenciaCliente.combo.facturas;
      await handleInvoiceChange(
        primera.id,
        derivedTags,
        resto.map((f) => ({ invoiceId: f.id, invoiceNumber: f.invoice_number, matchedAmount: f.balance_pending })),
      );
    } else if (sugerenciaCliente.abonoA) {
      await handleInvoiceChange(sugerenciaCliente.abonoA.id, derivedTags);
    }
  }

  async function aceptarSugerenciaFactura() {
    if (!sugerenciaFactura) return;
    await confirmarMatch.mutateAsync(sugerenciaFactura);
    // Sincronizar la fila local con lo que el confirm escribió en la base.
    const inv = sugerenciaFactura.signals;
    const respFactura = responsibles.find((r) => r.name === inv.counterparty_name)?.id ?? null;
    updateField({
      invoice_id: sugerenciaFactura.invoice_id,
      ...(localTransaction.responsible_id ? {} : respFactura ? { responsible_id: respFactura } : {}),
      ...(localTransaction.category_id ? {} : (() => {
        const ventas = categories.find((c) => c.name.toLowerCase().includes('venta'))?.id;
        return ventas ? { category_id: ventas } : {};
      })()),
    });
  }
  // Descripciones "no auditar" (pagos de clientes por transferencia/Nequi):
  // ni chips por descripción ni alertas — el beneficiario varía legítimamente.
  const descExcluida = esExcluida(localTransaction.description);

  // Beneficiarios sugeridos para ESTA fila: por categoría + monto. El que
  // calza en monto va primero ("Nómina de $1.250.000 → Rocío, 7 veces").
  const sugerenciasResp = useMemo(
    () => (historial && localTransaction.category_id
      ? sugerirBeneficiario(historial, localTransaction.category_id, localTransaction.amount)
      : []),
    [historial, localTransaction.category_id, localTransaction.amount],
  );
  const sugerenciaCat = useMemo(
    () => (historial && !localTransaction.category_id && !descExcluida
      ? sugerirCategoria(historial, localTransaction.description)
      : null),
    [historial, localTransaction.category_id, localTransaction.description, descExcluida],
  );

  // Prepare options for searchable selects
  const categoryOptions = categories
    .filter(c => c.active)
    .map(c => ({ value: c.id, label: c.name }));

  // Los sugeridos se fijan arriba de la lista, con estrella y su evidencia.
  const responsibleOptions = useMemo(() => {
    const base = responsibles.filter(r => r.active);
    if (!sugerenciasResp.length) return base.map(r => ({ value: r.id, label: r.name }));
    const rank = new Map(sugerenciasResp.map((s, i) => [s.responsibleId, i]));
    return [...base]
      .sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99))
      .map(r => {
        const s = sugerenciasResp.find(x => x.responsibleId === r.id);
        return { value: r.id, label: s ? `★ ${r.name} · ${s.veces}×` : r.name };
      });
  }, [responsibles, sugerenciasResp]);

  // Derive invoiceId and tags from transaction data
  const derivedInvoiceId = localTransaction.invoice_id || null;
  const derivedTags = useMemo((): InvoiceTag[] => {
    const t: InvoiceTag[] = [];
    const notes = localTransaction.notes || '';
    if (notes.includes('[N/A - Sin factura]')) t.push('na');
    if (notes.includes('[IVA a favor - Pago DIAN]')) t.push('iva_favor');
    if (notes.includes('[Retefuente - Sin factura]') || localTransaction.has_retefuente) t.push('retefuente');
    if (notes.includes('[Anticipo]')) t.push('anticipo');
    return t;
  }, [localTransaction.notes, localTransaction.has_retefuente]);

  // Bucket de conciliación: define si esta fila puede tener factura de cartera
  const bucket = useMemo(
    () => classifyBucket(
      localTransaction,
      categories.find(c => c.id === localTransaction.category_id)?.name ?? null,
    ),
    [localTransaction, categories],
  );

  return (
    <TableRow
      className={cn(
        'hover:bg-muted/30 transition-colors',
        !isReconciled && 'bg-warning/5 border-l-2 border-l-warning'
      )}
      style={!isReconciled ? {
        borderLeft: '3px solid oklch(0.65 0.15 65)',
        background: 'oklch(0.65 0.15 65 / 0.03)',
      } : {}}
    >
      <TableCell className="font-medium text-sm w-[72px] relative">
        {format(parseLocalDate(localTransaction.date), 'dd MMM', { locale: es })}
        {/* Feedback del guardado optimista: si falla (red, RLS), el usuario
            se entera acá en vez de creer que quedó conciliado. Overlay
            absoluto para no cambiar la altura de la fila al aparecer. */}
        <div className="absolute left-2 bottom-0.5 pointer-events-auto">
          <SaveStatusIndicator status={status} errorMessage={errorMessage} />
        </div>
      </TableCell>

      <TableCell>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-sm truncate flex-1 cursor-help">
                {localTransaction.description}
              </span>
              {canEditDescription && (
                <CardDescriptionEditor
                  currentDescription={localTransaction.description ?? ''}
                  onPick={(description) => updateField({ description })}
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 shrink-0"
                onClick={() => onViewDetail(localTransaction)}
              >
                <Eye className="h-3 w-3" />
              </Button>
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[500px]">
            <p className="text-sm whitespace-pre-wrap">{localTransaction.description}</p>
          </TooltipContent>
        </Tooltip>
      </TableCell>

      <TableCell className={`text-right font-bold text-sm w-[100px] ${amountColor}`}>
        {formatCurrency(localTransaction.amount)}
      </TableCell>

      {/* Simplified Type Selector */}
      <TableCell className="w-[80px]">
        <Select
          value={localTransaction.type || 'egreso'}
          onValueChange={(value) => handleTypeChange(value as SimpleTransactionType)}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SIMPLE_TYPES.map((type) => (
              <SelectItem key={type.value} value={type.value}>
                <span className={type.color}>{type.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>

      {/* Category */}
      <TableCell className="w-[170px]">
        <SearchableSelect
          options={categoryOptions}
          value={localTransaction.category_id}
          onChange={handleCategoryChange}
          placeholder="Categoría"
          emptyLabel="Sin categoría"
          addLabel="+ Agregar categoría"
          onAdd={handleAddCategory}
          triggerClassName="w-full"
        />
        {/* Sugerencia de un clic: la categoría dominante de esta descripción. */}
        {!localTransaction.category_id && sugerenciaCat && (
          <button
            className="mt-0.5 block max-w-full truncate text-[10px] text-primary hover:underline text-left"
            title={`Así clasificaste esta descripción ${sugerenciaCat.veces} de ${sugerenciaCat.total} veces. Clic para aplicar.`}
            onClick={() => handleCategoryChange(sugerenciaCat.categoryId)}
          >
            ¿{categories.find(c => c.id === sugerenciaCat.categoryId)?.name}? · {sugerenciaCat.veces} de {sugerenciaCat.total}
          </button>
        )}
      </TableCell>

      {/* Responsible */}
      <TableCell className="w-[170px]">
        <div className="flex items-center gap-1">
          <SearchableSelect
            options={responsibleOptions}
            value={localTransaction.responsible_id}
            onChange={handleResponsibleChange}
            placeholder="Pendiente"
            emptyLabel="Pendiente"
            addLabel="+ Agregar beneficiario"
            onAdd={handleAddResponsible}
            optionHref={(id) => `/terceros/${id}`}
            triggerClassName={cn('w-full', !localTransaction.responsible_id && 'border-warning/50 text-warning')}
          />
          {!localTransaction.responsible_id && (
            <span className="shrink-0 text-[10px] text-warning font-medium">⚠</span>
          )}
          {/* Ficha del tercero: "quería ver quién era y no pude" (Nico
              2026-08-06). Abre en pestaña nueva para no perder la conciliación. */}
          {localTransaction.responsible_id && (
            <a
              href={`/terceros/${localTransaction.responsible_id}`}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
              title="Ver la ficha de este tercero (NIT, contacto, cartera, qué compra)"
            >
              <Info className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
        {/* Fases 4+5: "¿de quién es este pago?" — cartera + combos de
            facturas + montos habituales + tiempos de pago. Con evidencia. */}
        {!localTransaction.responsible_id && sugerenciaCliente && (
          <button
            className="mt-0.5 block max-w-full truncate text-[10px] text-primary hover:underline text-left"
            title={`${sugerenciaCliente.confianza}% · ${sugerenciaCliente.señales.join(' · ')}. Clic para asignar${sugerenciaCliente.combo ? ' y vincular las facturas' : sugerenciaCliente.abonoA ? ' y vincular la factura' : ''}.`}
            onClick={aceptarSugerenciaCliente}
          >
            ¿{sugerenciaCliente.nombre}? · {sugerenciaCliente.confianza}%
            {sugerenciaCliente.combo ? ` · ${sugerenciaCliente.combo.facturas.map((f) => f.invoice_number).join('+')}` : ''}
          </button>
        )}
        {/* Sugerencia de un clic: beneficiario por categoría + monto
            ("Nómina de $1.250.000 → Rocío Gaitán, 7 veces"). */}
        {!localTransaction.responsible_id && !sugerenciaCliente && sugerenciasResp[0] && (
          <button
            className="mt-0.5 block max-w-full truncate text-[10px] text-primary hover:underline text-left"
            title={`${sugerenciasResp[0].veces} pagos en esta categoría${sugerenciasResp[0].evidenciaMonto ? ` · ${sugerenciasResp[0].evidenciaMonto}` : ''}${sugerenciasResp[0].calzaMonto ? ' · el monto calza' : ''}. Clic para aplicar.`}
            onClick={() => handleResponsibleChange(sugerenciasResp[0].responsibleId)}
          >
            ¿{responsibles.find(r => r.id === sugerenciasResp[0].responsibleId)?.name}?
            {' '}· {sugerenciasResp[0].veces}×{sugerenciasResp[0].calzaMonto ? ' · monto calza ✓' : ''}
          </button>
        )}
      </TableCell>

      {/* #Factura — solo donde puede existir factura. Traspasos y movimientos
          generados por el banco (4x1000, intereses, comisiones) tienen N/A
          automático y silencioso: pintar un dropdown vacío ahí era el ruido
          que hacía sentir el módulo incompleto. */}
      <TableCell className="w-[140px]">
        {bucketWantsInvoice(bucket, localTransaction.type) ? (
          <>
          <InvoiceSelector
            invoiceId={derivedInvoiceId}
            tags={derivedTags}
            transactionType={localTransaction.type || 'egreso'}
            transactionAmount={localTransaction.amount}
            transactionDate={localTransaction.date}
            transactionId={localTransaction.id}
            responsibleId={localTransaction.responsible_id}
            responsibleName={responsibles.find(r => r.id === localTransaction.responsible_id)?.name ?? null}
            onChange={handleInvoiceChange}
          />
          {/* Sugerencia del motor: "¿este ingreso es la factura X de Y?" —
              con su evidencia. ✓ vincula Y concilia; ✕ la descarta. */}
          {sugerenciaFactura && !derivedInvoiceId && (
            <span className="mt-0.5 flex items-center gap-1 max-w-full">
              <button
                className="min-w-0 truncate text-[10px] text-primary hover:underline text-left"
                disabled={confirmarMatch.isPending}
                title={`Confianza ${sugerenciaFactura.confidence}% · saldo ${sugerenciaFactura.signals.balance_pending ?? '—'} · clic para vincular y conciliar`}
                onClick={aceptarSugerenciaFactura}
              >
                ¿{sugerenciaFactura.signals.counterparty_name ?? 'Cliente'} · {sugerenciaFactura.signals.invoice_number ?? 'FV'}? · {sugerenciaFactura.confidence}%
              </button>
              <button
                className="shrink-0 text-[10px] text-muted-foreground hover:text-destructive"
                disabled={rechazarMatch.isPending}
                title="No es esta factura"
                onClick={() => rechazarMatch.mutate(sugerenciaFactura.id)}
              >
                ✕
              </button>
            </span>
          )}
          </>
        ) : (
          <span
            className="text-[10px] text-muted-foreground/60 select-none"
            title={bucket === 'traspaso'
              ? 'Traspaso entre cuentas propias — no lleva factura'
              : 'Generado por el banco — no lleva factura'}
          >
            {bucket === 'traspaso' ? '⇄ traspaso' : '— banco'}
          </span>
        )}
      </TableCell>

      {/* Naturaleza del movimiento — operativo vs traspaso/devolución/préstamo/aporte */}
      <TableCell className="w-[120px]">
        <Select
          value={localTransaction.movement_nature ?? 'operativo'}
          onValueChange={handleNatureChange}
        >
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MOVEMENT_NATURES.map((n) => (
              <SelectItem key={n.value} value={n.value}>
                <span className="text-xs">{n.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
    </TableRow>
  );
}
