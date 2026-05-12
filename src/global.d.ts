// Build-time constant injected by esbuild
declare const PLUGIN_VERSION: string;

// esbuild loads .svg files as text via the `text` loader
declare module "*.svg" {
  const content: string;
  export default content;
}
