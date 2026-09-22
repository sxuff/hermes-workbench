// React is supplied by the host SDK at runtime, never bundled by the plugin.
declare namespace JSX {
  interface IntrinsicAttributes { key?: string | number }
  interface IntrinsicElements { [name: string]: any }
}
