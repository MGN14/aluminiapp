// Modal para generar Comprobante de Ingreso (PDF) desde un movimiento de
// Caja Menor con kind='ingreso_efectivo'. Análogo a GenerarCuentaDeCobroModal
// pero para INGRESOS: aquí declarás que RECIBISTE plata del pagador.
//
// Toggle "Usar formato de empresa" controla si el PDF usa la hoja membretada
// (si está configurada en Settings) o un formato limpio con header simple.

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { FileDown, Building2, ReceiptText, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useDataOwner } from '@/hooks/useDataOwner';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { generateComprobanteIngresoPdf, type ComprobanteIngresoData } from '@/lib/comprobanteIngresoPdf';
import type { PettyCashRow } from '@/hooks/usePettyCashMovements';

interface Props {
  movement: PettyCashRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface CompanyData {
  company_name: string | null;
  company_nit: string | null;
  company_address: string | null;
  company_city: string | null;
  letterhead_path: string | null;
  letterhead_top_margin_mm: number;
  letterhead_bottom_margin_mm: number;
}

interface ResponsibleData {
  id: string;
  name: string;
  nit: string | null;
  tipo_documento: string | null;
  ciudad: string | null;
  telefono: string | null;
}

const LETTERHEAD_BUCKET = 'letterheads';

export default function GenerarComprobanteIngresoModal({ movement, open, onOpenChange }: Props) {
  const { dataOwnerId } = useDataOwner();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [generating, setGenerating] = useState(false);
  const [useLetterhead, setUseLetterhead] = useState(true);
  const [consecutivoEditable, setConsecutivoEditable] = useState('');
  const [conceptoEditable, setConceptoEditable] = useState('');
  const [metodoPago, setMetodoPago] = useState<string>('Efectivo');
  const [referenciaDoc, setReferenciaDoc] = useState('');

  // Datos editables del pagador (quien te dio la plata)
  const [pagador, setPagador] = useState({
    nombre: '',
    tipo_documento: 'CC' as 'CC' | 'CE' | 'PA' | 'NIT',
    documento: '',
    ciudad: '',
    telefono: '',
  });

  const [empresa, setEmpresa] = useState<CompanyData>({
    company_name: '',
    company_nit: '',
    company_address: '',
    company_city: '',
    letterhead_path: null,
    letterhead_top_margin_mm: 35,
    letterhead_bottom_margin_mm: 25,
  });

  // Cargar empresa del owner (no del colaborador)
  const { data: companyData } = useQuery<CompanyData>({
    queryKey: ['profile-company-ci', dataOwnerId],
    enabled: !!dataOwnerId && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('company_name, company_nit, company_address, company_city, letterhead_path, letterhead_top_margin_mm, letterhead_bottom_margin_mm')
        .eq('user_id', dataOwnerId!)
        .maybeSingle();
      if (error) throw error;
      const fallback: CompanyData = {
        company_name: '', company_nit: '', company_address: '', company_city: '',
        letterhead_path: null, letterhead_top_margin_mm: 35, letterhead_bottom_margin_mm: 25,
      };
      return (data ?? fallback) as unknown as CompanyData;
    },
  });

  // Cargar datos del pagador (responsible vinculado al movimiento)
  const { data: responsibleData } = useQuery<ResponsibleData | null>({
    queryKey: ['responsible-ci', movement?.responsible_id],
    enabled: !!movement?.responsible_id && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('responsibles')
        .select('id, name, nit, tipo_documento, ciudad, telefono')
        .eq('id', movement!.responsible_id!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as ResponsibleData | null;
    },
  });

  useEffect(() => {
    if (companyData) {
      setEmpresa(companyData);
      // Si no hay letterhead configurado, forzamos toggle off
      if (!companyData.letterhead_path) setUseLetterhead(false);
    }
  }, [companyData]);

  useEffect(() => {
    if (responsibleData) {
      setPagador({
        nombre: responsibleData.name ?? '',
        tipo_documento: (responsibleData.tipo_documento as 'CC' | 'CE' | 'PA' | 'NIT') ?? 'CC',
        documento: responsibleData.nit ?? '',
        ciudad: responsibleData.ciudad ?? '',
        telefono: responsibleData.telefono ?? '',
      });
    } else if (movement && !movement.responsible_id) {
      // Movimiento sin responsible: usuario completa manualmente
      setPagador({ nombre: '', tipo_documento: 'CC', documento: '', ciudad: '', telefono: '' });
    }
  }, [responsibleData, movement]);

  useEffect(() => {
    if (movement) {
      setConceptoEditable(movement.concept ?? '');
      setConsecutivoEditable(
        movement.numero_consecutivo
          ?? (movement as { numero_cuenta_cobro?: string | null }).numero_cuenta_cobro
          ?? ''
      );
      setMetodoPago('Efectivo');
      setReferenciaDoc('');
    }
  }, [movement]);

  const empresaCompleta = useMemo(
    () => !!(empresa.company_name && empresa.company_nit),
    [empresa.company_name, empresa.company_nit],
  );

  const hasLetterheadConfigured = !!empresa.letterhead_path;

  const handleGenerate = async () => {
    if (!movement) return;
    if (!pagador.nombre.trim()) {
      toast({ title: 'Falta nombre del pagador', variant: 'destructive' });
      return;
    }
    if (!conceptoEditable.trim()) {
      toast({ title: 'Falta concepto', variant: 'destructive' });
      return;
    }

    setGenerating(true);
    try {
      // 1) Persistir cambios en responsible (si hay) para que queden guardados
      if (movement.responsible_id && responsibleData) {
        const respChanged =
          pagador.nombre !== (responsibleData.name ?? '')
          || pagador.documento !== (responsibleData.nit ?? '')
          || pagador.tipo_documento !== (responsibleData.tipo_documento ?? 'CC')
          || pagador.ciudad !== (responsibleData.ciudad ?? '')
          || pagador.telefono !== (responsibleData.telefono ?? '');

        if (respChanged) {
          const { error: respErr } = await supabase
            .from('responsibles')
            .update({
              name: pagador.nombre,
              nit: pagador.documento || null,
              tipo_documento: pagador.tipo_documento,
              ciudad: pagador.ciudad || null,
              telefono: pagador.telefono || null,
            })
            .eq('id', movement.responsible_id);
          if (respErr) throw respErr;
        }
      }

      // 2) Persistir concepto + consecutivo en el movement
      const consecutivoTrim = consecutivoEditable.trim();
      const movUpdate: Record<string, unknown> = {
        concept: conceptoEditable.trim(),
      };
      if (consecutivoTrim && consecutivoTrim !== movement.numero_consecutivo) {
        movUpdate.numero_consecutivo = consecutivoTrim;
      }
      const { error: movErr } = await supabase
        .from('petty_cash_movements')
        .update(movUpdate)
        .eq('id', movement.id);
      if (movErr) throw movErr;

      // 3) Cargar letterhead si aplica
      let letterheadDataUri: string | undefined;
      let letterheadFormat: 'PNG' | 'JPEG' | undefined;
      if (useLetterhead && empresa.letterhead_path) {
        try {
          const { data: blob, error: dlErr } = await supabase.storage
            .from(LETTERHEAD_BUCKET)
            .download(empresa.letterhead_path);
          if (dlErr) throw dlErr;
          letterheadDataUri = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          });
          const ext = empresa.letterhead_path.split('.').pop()?.toLowerCase();
          letterheadFormat = ext === 'jpg' || ext === 'jpeg' ? 'JPEG' : 'PNG';
        } catch (e) {
          console.error('Error cargando letterhead:', e);
          toast({
            title: 'No se pudo cargar la hoja membretada',
            description: 'Se generará el PDF sin membrete.',
            variant: 'destructive',
          });
        }
      }

      // 4) Generar PDF
      const fechaFormatted = format(parseISO(movement.date), "d 'de' MMMM 'de' yyyy", { locale: es });
      const data: ComprobanteIngresoData = {
        useLetterhead: useLetterhead && !!letterheadDataUri,
        letterheadDataUri,
        letterheadFormat,
        letterheadTopMarginMm: empresa.letterhead_top_margin_mm,
        letterheadBottomMarginMm: empresa.letterhead_bottom_margin_mm,
        empresaNombre: empresa.company_name ?? undefined,
        empresaNit: empresa.company_nit ?? undefined,
        empresaDireccion: empresa.company_address ?? undefined,
        empresaCiudad: empresa.company_city ?? undefined,
        pagadorNombre: pagador.nombre,
        pagadorTipoDocumento: pagador.tipo_documento,
        pagadorDocumento: pagador.documento || undefined,
        pagadorCiudad: pagador.ciudad || undefined,
        pagadorTelefono: pagador.telefono || undefined,
        numeroConsecutivo: consecutivoTrim || movement.numero_consecutivo || '—',
        fecha: fechaFormatted,
        ciudadEmision: empresa.company_city || pagador.ciudad || 'Bogotá D.C.',
        monto: movement.amount,
        concepto: conceptoEditable.trim(),
        metodoPago,
        referenciaDoc: referenciaDoc.trim() || undefined,
      };

      const pdf = generateComprobanteIngresoPdf(data);
      const safePagador = pagador.nombre.replace(/\s+/g, '-').toLowerCase();
      const filename = `comprobante-pago-${data.numeroConsecutivo}-${safePagador}.pdf`;
      pdf.save(filename);

      await queryClient.invalidateQueries({ queryKey: ['petty-cash-movements'] });

      toast({ title: 'Comprobante generado', description: filename });
      onOpenChange(false);
    } catch (err) {
      console.error('Error generando comprobante:', err);
      toast({
        title: 'Error generando comprobante',
        description: err instanceof Error ? err.message : String(err),
        variant: 'destructive',
      });
    } finally {
      setGenerating(false);
    }
  };

  if (!movement) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ReceiptText className="h-5 w-5 text-success" />
            Generar comprobante de pago
          </DialogTitle>
          <DialogDescription className="text-xs">
            PDF para enviarle al cliente como constancia de que recibiste su pago. Editá los datos antes de descargar — se guardan automáticamente.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Empresa (read-only, link a settings) */}
          {!empresaCompleta && (
            <div className="p-3 rounded-lg border border-warning/40 bg-warning/5 text-xs">
              <p className="font-medium text-foreground flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5" />
                Faltan datos de la empresa
              </p>
              <p className="text-muted-foreground mt-1">
                El PDF queda incompleto sin nombre y NIT. Completalos en Ajustes → Datos de empresa.
              </p>
            </div>
          )}

          {/* Numero consecutivo + fecha (info) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Número</Label>
              <Input
                value={consecutivoEditable}
                onChange={(e) => setConsecutivoEditable(e.target.value)}
                placeholder="CP-2026-0001"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Fecha</Label>
              <Input
                value={format(parseISO(movement.date), "d 'de' MMMM 'de' yyyy", { locale: es })}
                disabled
                className="text-sm"
              />
            </div>
          </div>

          {/* Pagador */}
          <div className="space-y-2 p-3 rounded-lg border border-border bg-muted/20">
            <Label className="text-sm font-semibold">Pagador (quien te dio la plata)</Label>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1">
                <Label className="text-xs">Nombre completo *</Label>
                <Input
                  value={pagador.nombre}
                  onChange={(e) => setPagador({ ...pagador, nombre: e.target.value })}
                  placeholder="Ej: Comercial El Sol S.A.S."
                  required
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tipo doc</Label>
                <Select
                  value={pagador.tipo_documento}
                  onValueChange={(v) => setPagador({ ...pagador, tipo_documento: v as typeof pagador.tipo_documento })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CC">Cédula</SelectItem>
                    <SelectItem value="NIT">NIT</SelectItem>
                    <SelectItem value="CE">Cédula Extranjería</SelectItem>
                    <SelectItem value="PA">Pasaporte</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Número documento</Label>
                <Input value={pagador.documento} onChange={(e) => setPagador({ ...pagador, documento: e.target.value })} placeholder="900.123.456-7" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Ciudad</Label>
                <Input value={pagador.ciudad} onChange={(e) => setPagador({ ...pagador, ciudad: e.target.value })} placeholder="Bogotá" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Teléfono</Label>
                <Input value={pagador.telefono} onChange={(e) => setPagador({ ...pagador, telefono: e.target.value })} placeholder="3001234567" />
              </div>
            </div>
          </div>

          {/* Concepto + método + referencia */}
          <div className="space-y-1.5">
            <Label className="text-xs">Concepto *</Label>
            <Input
              value={conceptoEditable}
              onChange={(e) => setConceptoEditable(e.target.value)}
              placeholder="Ej: Abono factura FV-001"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Método de pago</Label>
              <Select value={metodoPago} onValueChange={setMetodoPago}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="Efectivo">Efectivo</SelectItem>
                  <SelectItem value="Transferencia">Transferencia</SelectItem>
                  <SelectItem value="Cheque">Cheque</SelectItem>
                  <SelectItem value="Tarjeta">Tarjeta</SelectItem>
                  <SelectItem value="Wompi">Wompi (link)</SelectItem>
                  <SelectItem value="Otro">Otro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Referencia / Factura (opcional)</Label>
              <Input value={referenciaDoc} onChange={(e) => setReferenciaDoc(e.target.value)} placeholder="Ej: FV-001" />
            </div>
          </div>

          {/* Toggle formato empresa */}
          <div className="flex items-start justify-between gap-3 p-3 rounded-lg border border-border bg-muted/20">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                Usar formato de empresa (hoja membretada)
              </Label>
              <p className="text-xs text-muted-foreground">
                {hasLetterheadConfigured
                  ? 'Tu hoja membretada va de fondo. Apagá si querés PDF limpio sin marca.'
                  : 'No tenés membrete cargado. Configurá uno en Ajustes → Hoja membretada para activar.'}
              </p>
            </div>
            <Switch
              checked={useLetterhead}
              onCheckedChange={setUseLetterhead}
              disabled={!hasLetterheadConfigured}
            />
          </div>
        </div>

        <DialogFooter className="mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generating}>
            Cancelar
          </Button>
          <Button onClick={handleGenerate} disabled={generating || !pagador.nombre.trim() || !conceptoEditable.trim()}>
            <FileDown className="h-4 w-4 mr-1.5" />
            {generating ? 'Generando…' : 'Generar PDF'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
