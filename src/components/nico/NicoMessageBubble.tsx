import { cn } from '@/lib/utils';
import nicoAvatar from '@/assets/nico-avatar.png';
import type { Msg } from './NicoDrawer';

interface NicoMessageBubbleProps {
  msg: Msg;
  isLast: boolean;
  isLoading: boolean;
}

export default function NicoMessageBubble({ msg, isLast, isLoading }: NicoMessageBubbleProps) {
  return (
    <div className={cn('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
      {msg.role === 'assistant' && (
        <div className="w-7 h-7 rounded-full overflow-hidden border border-border bg-muted mr-2 flex-shrink-0 mt-0.5">
          <img src={nicoAvatar} alt="Nico" className="w-full h-full object-cover object-top" />
        </div>
      )}
      <div
        className={cn(
          'max-w-[82%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap',
          msg.role === 'user'
            ? 'bg-success text-white rounded-br-sm'
            : 'bg-card text-foreground border border-border rounded-bl-sm'
        )}
      >
        {msg.content}
        {msg.role === 'assistant' && isLast && isLoading && (
          <span className="inline-block w-1.5 h-4 bg-success/60 ml-1 animate-pulse rounded-sm" />
        )}
      </div>
    </div>
  );
}
