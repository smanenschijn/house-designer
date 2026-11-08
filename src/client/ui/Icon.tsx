import type { SVGProps } from 'react';

/** Eenvoudige lijniconen (24×24, currentColor). */
const PATHS = {
  rotateLeft: 'M4 9a8 8 0 1 1 1.6 7.2M4 4v5h5',
  rotateRight: 'M20 9a8 8 0 1 0-1.6 7.2M20 4v5h-5',
  focus: 'M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M12 9v6M9 12h6',
  sun: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 20a8 8 0 0 1 16 0',
  library: 'M4 10V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2M3 11a1.5 1.5 0 0 1 3 0v3h12v-3a1.5 1.5 0 0 1 3 0v6H3v-6ZM5 17v2M19 17v2',
  close: 'M6 6l12 12M18 6 6 18',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  edit: 'M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4',
  magnet: 'M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4H6ZM6 8h4M14 8h4',
  key: 'M14 10a4 4 0 1 0-3.5 3.97L9 15.5V18h2.5v2H14v-2.5l1.03-1.03A4 4 0 0 0 14 10Zm1.5-1.5h.01',
  plus: 'M12 5v14M5 12h14',
  cube: 'M12 3 4 7.5v9L12 21l8-4.5v-9L12 3ZM4 7.5 12 12l8-4.5M12 12v9',
  iso: 'M12 4 3 9l9 5 9-5-9-5ZM3 14l9 5 9-5',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10',
  north: 'M12 3l5 15-5-3-5 3 5-15Z',
  layers: 'M12 3 2 8l10 5 10-5-10-5ZM2 13l10 5 10-5M2 17.5l10 5 10-5',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}
