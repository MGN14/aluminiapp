import { useState } from 'react';
import { Star } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface AppFeedbackModalProps {
  open: boolean;
  onClose: () => void;
  onSubmitted: () => void;
  onPostpone: () => void;
}

export default function AppFeedbackModal({ open, onClose, onSubmitted, onPostpone }: AppFeedbackModalProps) {
  const { user } = useAuth();
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [wishlist, setWishlist] = useState('');
  const [comments, setComments] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!user?.id || rating < 1) {
      toast.error('Seleccioná una calificación de 1 a 5 estrellas');
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from('app_feedback' as never).insert({
        user_id: user.id,
        rating,
        wishlist: wishlist.trim() || null,
        comments: comments.trim() || null,
        app_version: import.meta.env.VITE_APP_VERSION ?? null,
      } as never);
      if (error) throw error;
      toast.success('¡Gracias por tu feedback!');
      onSubmitted();
    } catch (err: any) {
      toast.error('No se pudo enviar el feedback', { description: err?.message ?? 'Intentá de nuevo' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onPostpone(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>¿Cómo te resulta AluminIA?</DialogTitle>
          <DialogDescription>
            Te toma 30 segundos. Tu feedback nos ayuda a priorizar qué mejorar.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">Calificación general</label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  onMouseEnter={() => setHoverRating(n)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="p-1 hover:scale-110 transition-transform"
                  aria-label={`${n} estrella${n > 1 ? 's' : ''}`}
                >
                  <Star
                    className={cn(
                      'h-8 w-8 transition-colors',
                      (hoverRating >= n || rating >= n)
                        ? 'fill-yellow-400 text-yellow-400'
                        : 'text-muted-foreground/40',
                    )}
                  />
                </button>
              ))}
              {rating > 0 && (
                <span className="ml-3 text-sm text-muted-foreground">
                  {rating === 5 ? '¡Excelente!' : rating === 4 ? 'Muy bien' : rating === 3 ? 'Aceptable' : rating === 2 ? 'Algo flojo' : 'Hay mucho por mejorar'}
                </span>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">¿Qué te gustaría que mejoremos?</label>
            <Textarea
              value={wishlist}
              onChange={(e) => setWishlist(e.target.value)}
              placeholder="Algo que te gustaría que la app hiciera, o algo que te frustra..."
              rows={3}
              className="resize-none"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Comentarios <span className="text-muted-foreground font-normal">(opcional)</span>
            </label>
            <Textarea
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Cualquier otra cosa que quieras decirnos..."
              rows={2}
              className="resize-none"
            />
          </div>
        </div>

        <div className="flex justify-between gap-2 pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onPostpone}
            disabled={submitting}
            className="text-muted-foreground"
          >
            Más tarde
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || rating < 1}
            className="bg-success hover:bg-success/90 text-success-foreground"
          >
            {submitting ? 'Enviando…' : 'Enviar feedback'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
