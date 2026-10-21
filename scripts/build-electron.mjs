import { build } from 'esbuild';
await build({ entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs', platform: 'node', target: 'node22', format: 'cjs', bundle: true, external: ['electron','original-fs'], sourcemap: false, minify: false });
await build({ entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs', platform: 'node', target: 'node22', format: 'cjs', bundle: true, external: ['electron'], sourcemap: false, minify: false });
