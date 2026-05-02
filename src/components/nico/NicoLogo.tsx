import { CSSProperties } from 'react';

interface NicoLogoProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Cuando true: fondo verde sólido, glifo blanco. Cuando false: glifo verde, fondo transparente. */
  filled?: boolean;
  /** Color del glifo cuando filled=false. Default: brand verde. */
  color?: string;
}

/**
 * Logo verde de Nico IA — burst/asterisco de 8 puntas inspirado en el logo
 * de Anthropic/Claude. Reemplaza la foto-avatar del asistente por una marca
 * más consistente y reconocible.
 */
export default function NicoLogo({
  size = 24,
  className,
  style,
  filled = false,
  color,
}: NicoLogoProps) {
  const BRAND = 'oklch(0.43 0.14 155)';
  const glyphColor = color ?? BRAND;

  if (filled) {
    return (
      <span
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: size,
          height: size,
          borderRadius: '50%',
          background: BRAND,
          flexShrink: 0,
          ...style,
        }}
      >
        <BurstGlyph size={Math.round(size * 0.6)} color="#ffffff" />
      </span>
    );
  }

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        flexShrink: 0,
        ...style,
      }}
    >
      <BurstGlyph size={size} color={glyphColor} />
    </span>
  );
}

function BurstGlyph({ size, color }: { size: number; color: string }) {
  // Burst de 8 puntas: 4 cardinales grandes + 4 diagonales más cortas.
  // Construido con elipses rotadas desde el centro (50,50) — geometría
  // simple y limpia, evita paths complejos.
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ display: 'block' }}
    >
      <g fill={color}>
        {/* 4 puntas largas — cardinales (N, E, S, W) */}
        <ellipse cx="50" cy="22" rx="7" ry="22" />
        <ellipse cx="50" cy="22" rx="7" ry="22" transform="rotate(90 50 50)" />
        <ellipse cx="50" cy="22" rx="7" ry="22" transform="rotate(180 50 50)" />
        <ellipse cx="50" cy="22" rx="7" ry="22" transform="rotate(270 50 50)" />
        {/* 4 puntas cortas — diagonales (NE, SE, SW, NW) */}
        <ellipse cx="50" cy="30" rx="4.5" ry="14" transform="rotate(45 50 50)" />
        <ellipse cx="50" cy="30" rx="4.5" ry="14" transform="rotate(135 50 50)" />
        <ellipse cx="50" cy="30" rx="4.5" ry="14" transform="rotate(225 50 50)" />
        <ellipse cx="50" cy="30" rx="4.5" ry="14" transform="rotate(315 50 50)" />
      </g>
    </svg>
  );
}
