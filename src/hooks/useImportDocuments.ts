import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';

export type ImportDocTipo = 'swift' | 'dim' | 'certificado_banrep' | 'costeo_excel' | 'otro';

export const IMPORT_DOC_LABEL: Record<ImportDocTipo, string> = {
  swift: 'Swift',
  dim: 'DIM (declaración de importación)',
  certificado_banrep: 'Certificado BanRep (excel)',
  costeo_excel: 'Excel de costeo',
  otro: 'Otro',
};

export interface ImportDocumentRow {
  id: string;
  import_id: string;
  tipo: ImportDocTipo;
  storage_path: string;
  filename: string | null;
  created_at: string;
}

const BUCKET = 'invoices'; // reusa bucket privado existente (policy: 1er folder = uid)

/**
 * Documentos del checklist de cierre de una importación (swift por abono,
 * DIM, certificado BanRep, excel de costeo) + cerrar/reabrir vía RPC.
 * El cierre lo valida el backend (cerrar_importacion): si falta algo devuelve
 * ok=false con la lista de faltantes.
 */
export function useImportDocuments(importId: string | null | undefined) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const enabled = !!user && !!importId;

  const docsQuery = useQuery<ImportDocumentRow[]>({
    queryKey: ['import_documents', importId],
    enabled,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('import_documents')
        .select('id, import_id, tipo, storage_path, filename, created_at')
        .eq('import_id', importId!)
        .order('created_at');
      if (error) throw error;
      return (data ?? []) as ImportDocumentRow[];
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['import_documents', importId] });
    qc.invalidateQueries({ queryKey: ['imports'] });
  };

  const upload = useMutation({
    mutationFn: async ({ tipo, file }: { tipo: ImportDocTipo; file: File }) => {
      if (!user || !importId) throw new Error('No auth');
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      const path = `${user.id}/imports/${importId}/${tipo}_${Date.now()}_${safeName}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type || 'application/octet-stream',
        upsert: false,
      });
      if (upErr) throw upErr;
      const { error } = await (supabase as any).from('import_documents').insert({
        user_id: user.id,
        import_id: importId,
        tipo,
        storage_path: path,
        filename: file.name,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Documento subido' });
    },
    onError: (e: Error) =>
      toast({ title: 'Error al subir documento', description: e.message, variant: 'destructive' }),
  });

  const remove = useMutation({
    mutationFn: async (doc: ImportDocumentRow) => {
      const { error } = await (supabase as any).from('import_documents').delete().eq('id', doc.id);
      if (error) throw error;
      // El archivo se borra best-effort: si falla queda huérfano en storage, no bloquea.
      await supabase.storage.from(BUCKET).remove([doc.storage_path]).catch(() => null);
    },
    onSuccess: () => invalidate(),
    onError: (e: Error) =>
      toast({ title: 'Error al eliminar documento', description: e.message, variant: 'destructive' }),
  });

  const view = async (doc: ImportDocumentRow) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.storage_path, 300);
    if (error || !data?.signedUrl) {
      toast({ title: 'No se pudo abrir el documento', description: error?.message, variant: 'destructive' });
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener');
  };

  const cerrar = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc('cerrar_importacion', { p_import_id: importId });
      if (error) throw error;
      return data as { ok: boolean; faltantes?: string[] };
    },
    onSuccess: (res) => {
      invalidate();
      if (res?.ok) {
        toast({ title: 'Importación cerrada', description: 'Checklist completo. Solo el admin puede modificarla.' });
      } else {
        toast({
          title: 'No se pudo cerrar — faltan documentos',
          description: (res?.faltantes ?? []).join(' · '),
          variant: 'destructive',
          duration: 10000,
        });
      }
    },
    onError: (e: Error) =>
      toast({ title: 'Error al cerrar', description: e.message, variant: 'destructive' }),
  });

  const reabrir = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).rpc('reabrir_importacion', { p_import_id: importId });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: 'Importación reabierta' });
    },
    onError: (e: Error) =>
      toast({ title: 'Error al reabrir', description: e.message, variant: 'destructive' }),
  });

  return {
    docs: docsQuery.data ?? [],
    isLoading: docsQuery.isLoading,
    upload,
    remove,
    view,
    cerrar,
    reabrir,
  };
}
