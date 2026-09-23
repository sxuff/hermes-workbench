// The dashboard supplies React and its SDK at runtime; the plugin never bundles React.
export const SDK = (window as any).__HERMES_PLUGIN_SDK__;
export const React = SDK.React;
export const { useState, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useCallback } = React;

export const text = (v: unknown): string => typeof v === 'string' ? v : '';
export const pretty = (v: unknown): string => typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v, null, 2);
export const obj = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
export const errorText = (e: unknown): string => e instanceof Error ? e.message : String(e);

/** Per-viewer conveniences only; storage can be missing or throw. */
export function readPref<T extends string>(key: string, fallback: T, allowed: readonly T[]): T {
  try { const v = localStorage.getItem(`hermes-workbench:${key}`) as T | null; return v && allowed.includes(v) ? v : fallback; }
  catch { return fallback; }
}
export function readText(key: string): string {
  try { return localStorage.getItem(`hermes-workbench:${key}`) ?? ''; } catch { return ''; }
}
export function writePref(key: string, value: string): void {
  try { localStorage.setItem(`hermes-workbench:${key}`, value); } catch { /* storage unavailable */ }
}
