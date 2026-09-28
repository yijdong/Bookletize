import * as React from 'react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export interface BorderBeamPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  beams?: 1 | 2;
  colors?: [string, string?];
  thickness?: number;
  idleSpeed?: number;
  hoverSpeed?: number;
  glow?: boolean;
  radius?: number;
  reducedMotion?: boolean;
}

class Spring {
  x: number;
  v = 0;
  target: number;
  constructor(value: number, private stiffness = 30, private damping = 11) {
    this.x = value;
    this.target = value;
  }
  step(dt: number) {
    const acceleration = this.stiffness * (this.target - this.x) - this.damping * this.v;
    this.v += acceleration * dt;
    this.x += this.v * dt;
    return this.x;
  }
}

const comet = (tail: string, head: string, start: number) => [
  `color-mix(in srgb, ${tail} 4%, transparent) ${start + 18}deg`,
  `color-mix(in srgb, ${tail} 55%, transparent) ${start + 46}deg`,
  `${head} ${start + 56}deg`,
  `color-mix(in srgb, ${head} 25%, white) ${start + 60}deg`,
  `transparent ${start + 63}deg`,
].join(', ');

const makeGradient = (beams: 1 | 2, colors?: [string, string?]) => {
  const first = colors?.[0] ?? 'var(--color-primary)';
  const firstHead = colors?.[0] ?? 'var(--color-primary-hover)';
  const second = colors?.[1] ?? 'var(--color-secondary)';
  const secondHead = colors?.[1] ?? 'var(--color-secondary-hover)';
  const stops = ['transparent 0deg', comet(first, firstHead, 0)];
  if (beams === 2) stops.push('transparent 180deg', comet(second, secondHead, 180));
  stops.push('transparent 360deg');
  return `conic-gradient(from var(--beam-angle, 0deg), ${stops.join(', ')})`;
};

export const BorderBeamPanel = React.forwardRef<HTMLDivElement, BorderBeamPanelProps>(function BorderBeamPanel({
  children,
  beams = 2,
  colors,
  thickness = 2,
  idleSpeed = 0,
  hoverSpeed = 42,
  glow = true,
  radius = 18,
  reducedMotion,
  className,
  style,
  ...props
}, forwardedRef) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [onScreen, setOnScreen] = React.useState(true);
  const [systemReduced, setSystemReduced] = React.useState(false);
  const [hovered, setHovered] = React.useState(false);
  const [focused, setFocused] = React.useState(false);
  const speedRef = React.useRef(new Spring(idleSpeed));
  const angleRef = React.useRef(165);
  const active = hovered || focused;

  React.useImperativeHandle(forwardedRef, () => rootRef.current!);

  React.useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystemReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  React.useEffect(() => {
    if (!rootRef.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(entries => setOnScreen(entries.some(entry => entry.isIntersecting)), { threshold: 0.05 });
    observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (reducedMotion || systemReduced || !onScreen || !active) {
      angleRef.current = 165;
      speedRef.current.x = idleSpeed;
      speedRef.current.target = idleSpeed;
      speedRef.current.v = 0;
      rootRef.current?.style.setProperty('--beam-angle', '165deg');
      return;
    }
    speedRef.current.target = hoverSpeed;
    let frameId = 0;
    let previousTime = 0;
    const frame = (time: number) => {
      if (!previousTime) previousTime = time;
      const delta = Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;
      angleRef.current += speedRef.current.step(delta) * delta;
      rootRef.current?.style.setProperty('--beam-angle', `${angleRef.current.toFixed(2)}deg`);
      frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(frameId);
  }, [active, hoverSpeed, idleSpeed, onScreen, reducedMotion, systemReduced]);

  const gradient = React.useMemo(() => makeGradient(beams as 1 | 2, colors), [beams, colors]);
  const ringStyle: React.CSSProperties = {
    inset: -1,
    borderRadius: radius,
    padding: Math.max(1, thickness),
    background: gradient,
    WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
    WebkitMaskComposite: 'xor',
    maskComposite: 'exclude',
  };

  return (
    <div
      ref={rootRef}
      data-motion={reducedMotion || systemReduced ? 'static' : 'animated'}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={cn('relative isolate w-full border border-primary bg-surface p-0', className)}
      style={{ borderRadius: radius, '--beam-angle': '165deg', ...style } as React.CSSProperties}
      {...props}
    >
      {glow && <div aria-hidden="true" className="pointer-events-none absolute opacity-30 blur-xl" style={{ ...ringStyle, WebkitMask: undefined, WebkitMaskComposite: undefined, maskComposite: undefined }} />}
      <div aria-hidden="true" className="pointer-events-none absolute z-20" style={ringStyle} />
      <div className="relative z-10">{children}</div>
    </div>
  );
});

export default BorderBeamPanel;
