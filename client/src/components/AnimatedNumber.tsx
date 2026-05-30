import { useEffect, useState, useRef } from 'react';
import { formatKES } from '../api/client';

interface Props {
  value: number;
  format?: 'kes' | 'number';
}

export default function AnimatedNumber({ value, format = 'number' }: Props) {
  const [displayValue, setDisplayValue] = useState(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (value === displayValue) return;

    const startValue = displayValue;
    const endValue = value;
    const duration = 800; // ms
    const startTime = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // easeOutExpo
      const easeProgress = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      
      const current = startValue + (endValue - startValue) * easeProgress;
      setDisplayValue(current);

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      } else {
        setDisplayValue(endValue);
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  if (format === 'kes') {
    return <>{formatKES(displayValue)}</>;
  }
  return <>{Math.round(displayValue)}</>;
}
