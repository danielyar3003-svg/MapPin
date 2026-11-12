import { build } from 'esbuild';

for (const name of ['main', 'preload']) {
  await build({
    entryPoints: [`electron/${name}.ts`],
    outfile: `dist-electron/${name}.cjs`,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    external: ['electron'],
  });
}
console.log('electron: ok');
