import {build} from 'esbuild';
import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dashboard/dist',{recursive:true});
await build({entryPoints:['src/app.tsx'],bundle:true,format:'iife',platform:'browser',target:['es2022'],outfile:'dashboard/dist/index.js',jsxFactory:'React.createElement',jsxFragment:'React.Fragment',minify:true, sourcemap:false});
await copyFile('src/style.css','dashboard/dist/style.css');
console.log('Built dashboard/dist/index.js and style.css');
