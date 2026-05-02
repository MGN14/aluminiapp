import { useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface SubmitFeedbackArgs {
  messageId: string;
  feedback: -1 | 0 | 1;
  feedbackText?: string | null;
}

export function useSubmitNicoFeedback() {
  return useMutation<void, Error, SubmitFeedbackArgs>({
    mutationFn: async ({ messageId, feedback, feedbackText }) => {
      const { error } = await supabase
        .from('nico_messages' as never)
        .update({
          feedback,
          feedback_text: feedbackText ?? null,
          feedback_at: new Date().toISOString(),
        } as never)
        .eq('id', messageId);
      if (error) throw error;
    },
  });
}
