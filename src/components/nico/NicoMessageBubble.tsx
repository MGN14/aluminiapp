import nicoAvatar from '@/assets/nico-avatar.png';
import type { Msg } from './NicoDrawer';

interface NicoMessageBubbleProps {
  msg: Msg;
  isLast: boolean;
  isLoading: boolean;
}

export default function NicoMessageBubble({ msg, isLast, isLoading }: NicoMessageBubbleProps) {
  const isUser = msg.role === 'user';

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        alignItems: 'flex-start',
        gap: 10,
      }}
    >
      {!isUser && (
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: '50%',
            overflow: 'hidden',
            border: '1px solid rgba(0,0,0,0.07)',
            background: '#f5f5f7',
            flexShrink: 0,
            marginTop: 2,
          }}
        >
          <img
            src={nicoAvatar}
            alt="Nico"
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
          />
        </div>
      )}
      <div
        style={{
          maxWidth: '82%',
          padding: isUser ? '10px 16px' : '12px 16px',
          borderRadius: isUser ? '20px 20px 5px 20px' : '20px 20px 20px 5px',
          fontSize: 13,
          lineHeight: 1.6,
          whiteSpace: 'pre-wrap',
          background: isUser ? '#1d1d1f' : '#f5f5f7',
          color: isUser ? '#fff' : '#1d1d1f',
        }}
      >
        {msg.content}
        {!isUser && isLast && isLoading && (
          <span
            style={{
              display: 'inline-block',
              width: 6,
              height: 14,
              background: 'oklch(0.43 0.14 155 / 0.6)',
              marginLeft: 4,
              verticalAlign: 'middle',
              animation: 'pulse 1s ease infinite',
              borderRadius: 2,
            }}
          />
        )}
      </div>
    </div>
  );
}
