import type { ComponentPropsWithoutRef, PointerEvent as ReactPointerEvent } from 'react';
import { cn } from './components/ui/utils';

export function LiquidGlassDefs() {
  return (
    <svg className="pointer-events-none absolute size-0 overflow-hidden" aria-hidden="true">
      <defs>
        <filter id="wormhole-liquid-glass" x="-10%" y="-10%" width="120%" height="120%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.012 0.018"
            numOctaves="2"
            seed="7"
            result="noise"
          />
          <feGaussianBlur in="noise" stdDeviation="2.5" result="softNoise" />
          <feDisplacementMap
            in="SourceGraphic"
            in2="softNoise"
            scale="10"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}

type LiquidGlassTag = 'div' | 'section' | 'article' | 'header' | 'li';

type LiquidGlassProps<T extends LiquidGlassTag = 'div'> = {
  as?: T;
  tone?: 'light' | 'dark' | 'obsidian';
  interactive?: boolean;
} & ComponentPropsWithoutRef<T>;

export function LiquidGlass<T extends LiquidGlassTag = 'div'>({
  as,
  tone = 'light',
  interactive = true,
  className,
  onPointerMove,
  onPointerLeave,
  children,
  ...props
}: LiquidGlassProps<T>) {
  const Element = (as ?? 'div') as 'div';

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    (onPointerMove as ((event: ReactPointerEvent<HTMLDivElement>) => void) | undefined)?.(event);
    if (!interactive || event.pointerType !== 'mouse') return;
    const target = event.currentTarget;
    const rect = target.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    target.style.setProperty('--lg-x', `${Math.round(event.clientX - rect.left)}px`);
    target.style.setProperty('--lg-y', `${Math.round(event.clientY - rect.top)}px`);
    target.style.setProperty('--lg-active', '1');
  };

  const handlePointerLeave = (event: ReactPointerEvent<HTMLDivElement>) => {
    (onPointerLeave as ((event: ReactPointerEvent<HTMLDivElement>) => void) | undefined)?.(event);
    if (!interactive) return;
    event.currentTarget.style.setProperty('--lg-active', '0');
  };

  return (
    <Element
      data-liquid-tone={tone}
      className={cn(
        'liquid-glass-surface',
        tone === 'obsidian'
          ? 'liquid-glass-obsidian'
          : tone === 'dark'
            ? 'liquid-glass-dark'
            : 'liquid-glass-light',
        interactive && 'liquid-glass-interactive',
        className
      )}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      {...(props as ComponentPropsWithoutRef<'div'>)}
    >
      {children}
    </Element>
  );
}
