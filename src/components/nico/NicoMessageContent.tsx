import { useState, useEffect, useRef } from 'react';

interface NicoMessageContentProps {
  content: string;
  isStreaming: boolean;
  isLastMessage: boolean;
}

/** Strip markdown bold/italic markers */
function cleanMarkdown(text: string): string {
  return text
    .replace(/\*\*\*(.*?)\*\*\*/g, '$1')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/__(.*?)__/g, '$1')
    .replace(/_(.*?)_/g, '$1');
}

export default function NicoMessageContent({ content, isStreaming, isLastMessage }: NicoMessageContentProps) {
  const cleaned = cleanMarkdown(content);
  const lines = cleaned.split('\n');
  const firstLine = lines[0] || '';
  const rest = lines.slice(1).join('\n');

  // Typewriter animation for first line only, on the last completed message
  const [displayedChars, setDisplayedChars] = useState(0);
  const animationDone = useRef(false);
  const prevContentRef = useRef('');

  // If streaming, show content as-is (already animated by stream)
  if (isStreaming) {
    return (
      <>
        {cleaned}
        <span className="inline-block w-1.5 h-4 bg-success/60 ml-1 animate-pulse rounded-sm" />
      </>
    );
  }

  // For completed messages, animate first line once
  useEffect(() => {
    if (!isLastMessage || animationDone.current) return;
    if (prevContentRef.current === content) return;
    prevContentRef.current = content;

    setDisplayedChars(0);
    let i = 0;
    const speed = Math.max(8, Math.min(20, 600 / firstLine.length)); // fast & fluid
    const timer = setInterval(() => {
      i++;
      setDisplayedChars(i);
      if (i >= firstLine.length) {
        clearInterval(timer);
        animationDone.current = true;
      }
    }, speed);
    return () => clearInterval(timer);
  }, [content, isLastMessage, firstLine.length]);

  // Non-last messages or already animated: show full text
  if (!isLastMessage || animationDone.current) {
    return <>{cleaned}</>;
  }

  // Animating: show partial first line + hide rest until done
  const visibleFirst = firstLine.slice(0, displayedChars);
  const showRest = displayedChars >= firstLine.length;

  return (
    <>
      {visibleFirst}
      {!showRest && <span className="inline-block w-1.5 h-4 bg-success/60 ml-0.5 animate-pulse rounded-sm" />}
      {showRest && rest && '\n' + rest}
    </>
  );
}
