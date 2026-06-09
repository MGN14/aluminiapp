// cult/ui — AnimatedNumber. Cuenta suavemente (spring) hasta el valor, estilo
// Apple. Portado a Vite (sin "use client"). Dep: motion.
import { useEffect } from 'react';
import { motion, MotionValue, useSpring, useTransform } from 'motion/react';

interface AnimatedNumberProps {
  value: number;
  mass?: number;
  stiffness?: number;
  damping?: number;
  precision?: number;
  format?: (value: number) => string;
  className?: string;
  onAnimationStart?: () => void;
  onAnimationComplete?: () => void;
}

export function AnimatedNumber({
  value,
  mass = 0.8,
  stiffness = 75,
  damping = 15,
  precision = 0,
  format = (num) => num.toLocaleString('es-CO'),
  className,
  onAnimationStart,
  onAnimationComplete,
}: AnimatedNumberProps) {
  const spring = useSpring(value, { mass, stiffness, damping });
  const display: MotionValue<string> = useTransform(spring, (current) =>
    format(parseFloat(current.toFixed(precision)))
  );

  useEffect(() => {
    spring.set(value);
    if (onAnimationStart) onAnimationStart();
    const unsubscribe = spring.on('change', () => {
      if (spring.get() === value && onAnimationComplete) onAnimationComplete();
    });
    return () => unsubscribe();
  }, [spring, value, onAnimationStart, onAnimationComplete]);

  return <motion.span className={className}>{display}</motion.span>;
}
