import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { FileDown, Building2, User } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { generateCuentaDeCobroPdf, type CuentaDeCobroData } from '@/lib/cuentaDeCobroPdf';
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

const LETTERHEAD_BUCKET = 'letterheads';

interface ResponsibleData {
  id: string;
  name: string;
  nit: string | null;
  tipo_documento: string | null;
  ciudad: string | null;
  telefono: string | null;
}

export default function GenerarCuentaDeCobroModal({ movement, open, onOpenChange }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [savingProveedor, setSavingProveedor] = useState(false);
  const [savingEmpresa, setSavingEmpresa] = useState(false);

  // Form state — datos editables que se guardan al hacer "Generar"
  const [empresa, setEmpresa] = useState<CompanyData>({
    company_name: '',
    company_nit: '',
    company_address: '',
    company_city: '',
    letterhead_path: null,
    letterhead_top_margin_mm: 35,
    letterhead_bottom_margin_mm: 25,
  });
  const [prestador, setPrestador] = useState({
    nombre: '',
    tipo_documento: 'CC' as 'CC' | 'CE' | 'PA' | 'NIT',
    documento: '',
    ciudad: '',
    telefono: '',
  });
  const [conceptoEditable, setConceptoEditable] = useState('');
  const [incluyePrestaciones, setIncluyePrestaciones] = useState(false);
  const [retencionStr, setRetencionStr] = useState('');

  // Cargar datos empresa
  const { data: companyData } = useQuery<CompanyData>({
    queryKey: ['profile-company-cdc', user?.id],
    enabled: !!user?.id && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('company_name, company_nit, company_address, company_city, letterhead_path, letterhead_top_margin_mm, letterhead_bottom_margin_mm')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      const fallback: CompanyData = {
        company_name: '', company_nit: '', company_address: '', company_city: '',
        letterhead_path: null, letterhead_top_margin_mm: 35, letterhead_bottom_margin_mm: 25,
      };
      return (data ?? fallback) as unknown as CompanyData;
    },
  });

  // Cargar datos del prestador (responsible) actualizado
  const { data: responsibleData } = useQuery<ResponsibleData | null>({
    queryKey: ['responsible-cdc', movement?.responsible_id],
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

  // Sync state con datos cargados cuando abre modal
  useEffect(() => {
    if (companyData) setEmpresa(companyData);
  }, [companyData]);

  useEffect(() => {
    if (responsibleData) {
      setPrestador({
        nombre: responsibleData.name ?? '',
        tipo_documento: (responsibleData.tipo_documento as 'CC' | 'CE' | 'PA' | 'NIT') ?? 'CC',
        documento: responsibleData.nit ?? '',
        ciudad: responsibleData.ciudad ?? '',
        telefono: responsibleData.telefono ?? '',
      });
    }
  }, [responsibleData]);

  useEffect(() => {
    if (movement) {
      setConceptoEditable(movement.concept ?? '');
      setIncluyePrestaciones(false);
      setRetencionStr('');
    }
  }, [movement]);

  const empresaCompleta = useMemo(
    () => !!(empresa.company_name && empresa.company_nit),
    [empresa]
  );
  const prestadorCompleto = useMemo(
    () => !!(prestador.nombre && prestador.documento),
    [prestador]
  );

  const handleGenerate = async () => {
    if (!movement) return;
    if (!empresaCompleta) {
      toast({ title: 'Falta info de tu empresa', description: 'Completá razón social y NIT.', variant: 'destructive' });
      return;
    }
    if (!prestadorCompleto) {
      toast({ title: 'Falta info del prestador', description: 'Completá nombre y número de documento.', variant: 'destructive' });
      return;
    }
    if (!conceptoEditable.trim()) {
      toast({ title: 'Falta concepto', variant: 'destructive' });
      return;
    }

    setGenerating(true);
    try {
      // 1) Guardar datos de empresa al profile (idempotente)
      setSavingEmpresa(true);
      const { error: profileErr } = await supabase
        .from('profiles')
        .update({
          company_name: empresa.company_name,
          company_nit: empresa.company_nit,
          company_address: empresa.company_address,
          company_city: empresa.company_city,
        })
        .eq('user_id', user!.id);
      if (profileErr) throw profileErr;
      setSavingEmpresa(false);

      // 2) Guardar datos del prestador en responsibles
      if (movement.responsible_id) {
        setSavingProveedor(true);
        const { error: respErr } = await supabase
          .from('responsibles')
          .update({
            name: prestador.nombre,
            nit: prestador.documento,
            tipo_documento: prestador.tipo_documento,
            ciudad: prestador.ciudad || null,
            telefono: prestador.telefono || null,
          })
          .eq('id', movement.responsible_id);
        if (respErr) throw respErr;
        setSavingProveedor(false);
      }

      // 3) Persistir incluye_prestaciones_sociales y retencion en el movement
      const retencionNum = parseFloat(retencionStr) || 0;
      const { error: movErr } = await supabase
        .from('petty_cash_movements')
        .update({
          incluye_prestaciones_sociales: incluyePrestaciones,
          retencion_amount: retencionNum > 0 ? retencionNum : null,
          concept: conceptoEditable.trim(),
        })
        .eq('id', movement.id);
      if (movErr) throw movErr;

      // 4) Cargar letterhead como dataURI si existe
      let letterheadDataUri: string | undefined;
      let letterheadFormat: 'PNG' | 'JPEG' | undefined;
      if (empresa.letterhead_path) {
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
          console.error('Error cargando hoja membretada:', e);
          toast({ title: 'No se pudo cargar la hoja membretada', description: 'Se generará el PDF con el diseño base.', variant: 'destructive' });
        }
      }

      // 5) Generar PDF
      const fechaFormatted = format(parseISO(movement.date), "d 'de' MMMM 'de' yyyy", { locale: es });
      const data: CuentaDeCobroData = {
        variant: movement.kind === 'cuenta_de_cobro' ? 'cuenta_de_cobro' : 'comprobante_pago',
        letterheadDataUri,
        letterheadFormat,
        letterheadTopMarginMm: empresa.letterhead_top_margin_mm,
        letterheadBottomMarginMm: empresa.letterhead_bottom_margin_mm,
        empresaNombre: empresa.company_name!,
        empresaNit: empresa.company_nit!,
        empresaDireccion: empresa.company_address ?? undefined,
        empresaCiudad: empresa.company_city ?? undefined,
        prestadorNombre: prestador.nombre,
        prestadorTipoDocumento: prestador.tipo_documento,
        prestadorDocumento: prestador.documento,
        prestadorCiudad: prestador.ciudad || undefined,
        prestadorTelefono: prestador.telefono || undefined,
        numeroConsecutivo: (movement as { numero_consecutivo?: string | null }).numero_consecutivo ?? movement.numero_cuenta_cobro ?? '—',
        fecha: fechaFormatted,
        ciudadEmision: empresa.company_city || prestador.ciudad || 'Bogotá D.C.',
        concepto: conceptoEditable.trim(),
        monto: movement.amount,
        retencion: retencionNum > 0 ? retencionNum : undefined,
        incluyePrestacionesSociales: incluyePrestaciones,
      };
      const pdf = generateCuentaDeCobroPdf(data);
      const docPrefix = data.variant === 'cuenta_de_cobro' ? 'cuenta-de-cobro' : 'comprobante-de-pago';
      const filename = `${docPrefix}-${data.numeroConsecutivo}-${prestador.nombre.replace(/\s+/g, '-').toLowerCase()}.pdf`;
      pdf.save(filename);

      // Refrescar la tabla
      await queryClient.invalidateQueries({ queryKey: ['petty-cash-movements'] });

      toast({ title: 'Cuenta de cobro generada' });
      onOpenChange(false);
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setGenerating(false);
      setSavingProveedor(false);
      setSavingEmpresa(false);
    }
  };

  const monto = movement?.amount ?? 0;
  const retencionNum = parseFloat(retencionStr) || 0;
  const neto = monto - retencionNum;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {movement?.kind === 'cuenta_de_cobro' ? 'Generar cuenta de cobro' : 'Generar comprobante de pago'}
          </DialogTitle>
          <DialogDescription>
            Los datos de tu empresa quedan guardados. Solo cambiás los del prestador en cada documento.
          </DialogDescription>
        </DialogHeader>

        {!movement ? (
          <p className="text-sm text-muted-foreground">No hay movimiento seleccionado.</p>
        ) : (
          <div className="space-y-5">
            {/* Empresa contratante */}
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <Building2 className="h-4 w-4" />
                Tu empresa
                {!empresaCompleta && (
                  <span className="text-[10px] uppercase tracking-wider text-destructive">
                    Faltan datos
                  </span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <Label className="text-xs">Razón social</Label>
                  <Input
                    value={empresa.company_name ?? ''}
                    onChange={(e) => setEmpresa({ ...empresa, company_name: e.target.value })}
                    placeholder="Nombre de tu empresa"
                  />
                </div>
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <Label className="text-xs">NIT</Label>
                  <Input
                    value={empresa.company_nit ?? ''}
                    onChange={(e) => setEmpresa({ ...empresa, company_nit: e.target.value })}
                    placeholder="900.123.456-7"
                  />
                </div>
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <Label className="text-xs">Dirección (opcional)</Label>
                  <Input
                    value={empresa.company_address ?? ''}
                    onChange={(e) => setEmpresa({ ...empresa, company_address: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <Label className="text-xs">Ciudad</Label>
                  <Input
                    value={empresa.company_city ?? ''}
                    onChange={(e) => setEmpresa({ ...empresa, company_city: e.target.value })}
                    placeholder="Bogotá D.C."
                  />
                </div>
              </div>
            </div>

            {/* Prestador */}
            <div className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <User className="h-4 w-4" />
                Prestador del servicio
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-xs">Nombre completo</Label>
                  <Input
                    value={prestador.nombre}
                    onChange={(e) => setPrestador({ ...prestador, nombre: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Tipo documento</Label>
                  <Select
                    value={prestador.tipo_documento}
                    onValueChange={(v) =>
                      setPrestador({ ...prestador, tipo_documento: v as 'CC' | 'CE' | 'PA' | 'NIT' })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="CC">Cédula de Ciudadanía</SelectItem>
                      <SelectItem value="CE">Cédula de Extranjería</SelectItem>
                      <SelectItem value="PA">Pasaporte</SelectItem>
                      <SelectItem value="NIT">NIT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Número documento</Label>
                  <Input
                    value={prestador.documento}
                    onChange={(e) => setPrestador({ ...prestador, documento: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Ciudad (opcional)</Label>
                  <Input
                    value={prestador.ciudad}
                    onChange={(e) => setPrestador({ ...prestador, ciudad: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Teléfono (opcional)</Label>
                  <Input
                    value={prestador.telefono}
                    onChange={(e) => setPrestador({ ...prestador, telefono: e.target.value })}
                  />
                </div>
              </div>
            </div>

            {/* Documento */}
            <div className="rounded-lg border p-4 space-y-3">
              <div className="text-sm font-semibold">Datos del documento</div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <Label className="text-xs">Número consecutivo</Label>
                  <Input value={movement.numero_cuenta_cobro ?? '(se asignó al guardar)'} disabled />
                </div>
                <div className="space-y-1.5 col-span-2 sm:col-span-1">
                  <Label className="text-xs">Fecha</Label>
                  <Input value={format(parseISO(movement.date), "d 'de' MMMM 'de' yyyy", { locale: es })} disabled />
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label className="text-xs">Concepto del servicio</Label>
                  <Textarea
                    rows={2}
                    value={conceptoEditable}
                    onChange={(e) => setConceptoEditable(e.target.value)}
                    placeholder="Ej: Servicio de cargue y descargue de mercancía 28 de abril 2026"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 pt-2 border-t">
                <Label htmlFor="prestaciones-toggle" className="text-xs cursor-pointer">
                  Incluir declaración de pago de salud y pensión (Art. 50 Ley 789/2002)
                </Label>
                <Switch
                  id="prestaciones-toggle"
                  checked={incluyePrestaciones}
                  onCheckedChange={setIncluyePrestaciones}
                />
              </div>

              <div className="space-y-1.5 pt-2 border-t">
                <Label className="text-xs">Retención en la fuente (opcional)</Label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  placeholder="0"
                  value={retencionStr}
                  onChange={(e) => setRetencionStr(e.target.value)}
                />
                {retencionNum > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    Valor neto a pagar: {new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(neto)}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={generating}>
            Cancelar
          </Button>
          <Button type="button" onClick={handleGenerate} disabled={generating || !movement} className="gap-2">
            <FileDown className="h-4 w-4" />
            {generating
              ? savingEmpresa
                ? 'Guardando empresa...'
                : savingProveedor
                  ? 'Guardando prestador...'
                  : 'Generando PDF...'
              : 'Generar y descargar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
