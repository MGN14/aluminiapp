import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Trash2, FileImage, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';

const BUCKET = 'letterheads';
const MAX_BYTES = 5 * 1024 * 1024;

interface ProfileLetterhead {
  letterhead_path: string | null;
  letterhead_top_margin_mm: number;
  letterhead_bottom_margin_mm: number;
}

export default function LetterheadSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);

  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [topMargin, setTopMargin] = useState<number>(35);
  const [bottomMargin, setBottomMargin] = useState<number>(25);

  const { data: profile } = useQuery<ProfileLetterhead | null>({
    queryKey: ['profile-letterhead', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('letterhead_path, letterhead_top_margin_mm, letterhead_bottom_margin_mm')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as unknown as ProfileLetterhead | null;
    },
  });

  // Cargar preview con signed URL cuando cambia el path
  useEffect(() => {
    let cancelled = false;
    const loadPreview = async () => {
      if (!profile?.letterhead_path) {
        setPreviewUrl(null);
        return;
      }
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(profile.letterhead_path, 3600);
      if (cancelled) return;
      if (error) {
        console.error('Error loading letterhead preview:', error);
        setPreviewUrl(null);
        return;
      }
      setPreviewUrl(data.signedUrl);
    };
    loadPreview();
    return () => { cancelled = true; };
  }, [profile?.letterhead_path]);

  // Sync margins con profile
  useEffect(() => {
    if (profile) {
      setTopMargin(profile.letterhead_top_margin_mm);
      setBottomMargin(profile.letterhead_bottom_margin_mm);
    }
  }, [profile]);

  const handleSelectFile = () => fileRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.size > MAX_BYTES) {
      toast({ title: 'Archivo muy grande', description: 'Máximo 5 MB.', variant: 'destructive' });
      return;
    }

    setUploading(true);
    try {
      // Eliminar el anterior si existe
      if (profile?.letterhead_path) {
        await supabase.storage.from(BUCKET).remove([profile.letterhead_path]);
      }

      const ext = file.name.split('.').pop()?.toLowerCase() || 'png';
      const path = `${user.id}/letterhead-${Date.now()}.${ext}`;

      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type,
      });
      if (upErr) throw upErr;

      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ letterhead_path: path } as never)
        .eq('user_id', user.id);
      if (profileErr) throw profileErr;

      await queryClient.invalidateQueries({ queryKey: ['profile-letterhead'] });
      toast({ title: 'Hoja membretada subida' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleDelete = async () => {
    if (!user || !profile?.letterhead_path) return;
    if (!confirm('¿Eliminar tu hoja membretada? Las próximas cuentas de cobro saldrán con el diseño base.')) return;

    setUploading(true);
    try {
      await supabase.storage.from(BUCKET).remove([profile.letterhead_path]);
      const { error } = await supabase
        .from('profiles')
        .update({ letterhead_path: null } as never)
        .eq('user_id', user.id);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['profile-letterhead'] });
      toast({ title: 'Hoja membretada eliminada' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(false);
    }
  };

  const handleSaveMargins = async () => {
    if (!user) return;
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          letterhead_top_margin_mm: topMargin,
          letterhead_bottom_margin_mm: bottomMargin,
        } as never)
        .eq('user_id', user.id);
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['profile-letterhead'] });
      toast({ title: 'Márgenes guardados' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="font-medium text-sm flex items-center gap-2">
          <FileImage className="h-4 w-4 text-muted-foreground" />
          Hoja membretada
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Subí una imagen PNG/JPG de tu hoja membretada. Las cuentas de cobro y comprobantes
          de pago de Caja Menor saldrán con tu hoja como fondo.
        </p>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/jpg"
        className="hidden"
        onChange={handleFileChange}
      />

      {previewUrl ? (
        <div className="space-y-3">
          <Card className="overflow-hidden bg-muted/20 p-2">
            <img
              src={previewUrl}
              alt="Hoja membretada"
              className="w-full h-auto max-h-[400px] object-contain mx-auto"
            />
          </Card>
          <div className="flex gap-2 flex-wrap">
            <Button variant="outline" size="sm" onClick={handleSelectFile} disabled={uploading} className="gap-2">
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              Reemplazar
            </Button>
            <Button variant="outline" size="sm" onClick={handleDelete} disabled={uploading} className="gap-2 text-destructive hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
              Eliminar
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-3 border-t">
            <div className="space-y-1.5">
              <Label htmlFor="topMargin" className="text-xs">Margen superior (mm)</Label>
              <Input
                id="topMargin"
                type="number"
                min="0"
                max="100"
                value={topMargin}
                onChange={(e) => setTopMargin(parseInt(e.target.value) || 0)}
              />
              <p className="text-[10px] text-muted-foreground">Espacio para no pisar el logo/header de tu hoja.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bottomMargin" className="text-xs">Margen inferior (mm)</Label>
              <Input
                id="bottomMargin"
                type="number"
                min="0"
                max="100"
                value={bottomMargin}
                onChange={(e) => setBottomMargin(parseInt(e.target.value) || 0)}
              />
              <p className="text-[10px] text-muted-foreground">Espacio para no pisar el footer.</p>
            </div>
          </div>
          <Button size="sm" onClick={handleSaveMargins} disabled={uploading}>
            Guardar márgenes
          </Button>
        </div>
      ) : (
        <Card
          className="border-dashed border-2 p-8 flex flex-col items-center justify-center gap-3 cursor-pointer hover:bg-muted/30 transition-colors"
          onClick={handleSelectFile}
        >
          {uploading ? (
            <Loader2 className="h-8 w-8 text-muted-foreground animate-spin" />
          ) : (
            <Upload className="h-8 w-8 text-muted-foreground" />
          )}
          <div className="text-center">
            <p className="text-sm font-medium">{uploading ? 'Subiendo...' : 'Subí tu hoja membretada'}</p>
            <p className="text-xs text-muted-foreground mt-1">PNG o JPG · máx 5 MB</p>
          </div>
        </Card>
      )}
    </div>
  );
}
