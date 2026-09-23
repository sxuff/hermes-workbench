import { React } from '../sdk';

// Tabler outline icons (MIT), the same set the Hermes desktop app uses for chrome.
const PATHS = {
  plus: 'M12 5l0 14M5 12l14 0',
  search: 'M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0M21 21l-6 -6',
  chat: 'M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1',
  folder: 'M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2',
  x: 'M18 6l-12 12M6 6l12 12',
  settings: 'M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0',
  arrowUp: 'M12 5l0 14M18 11l-6 -6M6 11l6 -6',
  arrowDown: 'M12 5l0 14M18 13l-6 6M6 13l6 6',
  chevronRight: 'M9 6l6 6l-6 6',
  chevronDown: 'M6 9l6 6l6 -6',
  terminal: 'M8 9l3 3l-3 3M13 15l3 0M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -12',
  file: 'M14 3v4a1 1 0 0 0 1 1h4M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2',
  fileDiff: 'M14 3v4a1 1 0 0 0 1 1h4M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2M12 10l0 4M10 12l4 0M10 17l4 0',
  fileText: 'M14 3v4a1 1 0 0 0 1 1h4M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2M9 9l1 0M9 13l6 0M9 17l6 0',
  bulb: 'M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3M9.7 17l4.6 0',
  users: 'M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0 -3 -3.85',
  fork: 'M10 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M5 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M15 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0M7 8v2a2 2 0 0 0 2 2h6a2 2 0 0 0 2 -2v-2M12 12l0 4',
  pencil: 'M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4M13.5 6.5l4 4',
  copy: 'M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1',
  check: 'M5 12l5 5l10 -10',
  alert: 'M12 9v4M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0M12 16h.01',
  sidebar: 'M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12M9 4l0 16',
  sidebarRight: 'M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12M15 4l0 16',
  maximize: 'M4 8v-2a2 2 0 0 1 2 -2h2M4 16v2a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v2M16 20h2a2 2 0 0 0 2 -2v-2',
  minimize: 'M15 19v-2a2 2 0 0 1 2 -2h2M15 5v2a2 2 0 0 0 2 2h2M5 15h2a2 2 0 0 1 2 2v2M5 9h2a2 2 0 0 0 2 -2v-2',
  sun: 'M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M3 12h1m8 -9v1m8 8h1m-9 8v1m-6.4 -15.4l.7 .7m12.1 -.7l-.7 .7m0 11.4l.7 .7m-12.1 -.7l-.7 .7',
  moon: 'M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446a9 9 0 1 1 -8.313 -12.454l0 .008',
  listCheck: 'M3.5 5.5l1.5 1.5l2.5 -2.5M3.5 11.5l1.5 1.5l2.5 -2.5M3.5 17.5l1.5 1.5l2.5 -2.5M11 6l9 0M11 12l9 0M11 18l9 0',
  world: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0M3.6 9h16.8M3.6 15h16.8M11.5 3a17 17 0 0 0 0 18M12.5 3a17 17 0 0 1 0 18',
  tool: 'M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5',
  circleCheck: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M9 12l2 2l4 -4',
  circleX: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M10 10l4 4m0 -4l-4 4',
  loader: 'M12 3a9 9 0 1 0 9 9',
  robot: 'M6 6a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2l0 -4M12 2v2M9 12v9M15 12v9M5 16l4 -2M15 14l4 2M9 18h6M10 8v.01M14 8v.01',
  brain: 'M15.5 13a3.5 3.5 0 0 0 -3.5 3.5v1a3.5 3.5 0 0 0 7 0v-1.8M8.5 13a3.5 3.5 0 0 1 3.5 3.5v1a3.5 3.5 0 0 1 -7 0v-1.8M17.5 16a3.5 3.5 0 0 0 0 -7h-.5M19 9.3v-2.8a3.5 3.5 0 0 0 -7 0M6.5 16a3.5 3.5 0 0 1 0 -7h.5M5 9.3v-2.8a3.5 3.5 0 0 1 7 0v10',
  dots: 'M4 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0M18 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0',
  stop: 'M17 4h-10a3 3 0 0 0 -3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3 -3v-10a3 3 0 0 0 -3 -3z',
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, filled = false, className = '' }: { name: IconName; filled?: boolean; className?: string }) {
  return <svg className={`hwb-icon ${className}`} viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke={filled ? 'none' : 'currentColor'}
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={PATHS[name]}/></svg>;
}

/** Map a Hermes tool name onto the compact vocabulary used by transcript rows. */
export function toolIcon(name: string): IconName {
  const n = name.toLowerCase();
  if (/terminal|shell|bash|exec|process/.test(n)) return 'terminal';
  if (/patch|edit|write|diff/.test(n)) return 'fileDiff';
  if (/read|file|search_files|glob|grep/.test(n)) return 'fileText';
  if (/web|browser|fetch|url|search/.test(n)) return 'world';
  if (/todo|plan/.test(n)) return 'listCheck';
  if (/delegate|agent|subagent/.test(n)) return 'robot';
  if (/clarify|question/.test(n)) return 'chat';
  if (/memory|skill/.test(n)) return 'brain';
  return 'tool';
}
