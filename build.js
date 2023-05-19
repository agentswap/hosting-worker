import * as esbuild from 'esbuild'
import esbuildPluginPino from 'esbuild-plugin-pino'

await esbuild.build({
  entryPoints: ['./src/index'],
  bundle: true,
  sourcemap: true,
  format: 'esm',
  target: 'esnext',
  platform: 'node',
  outdir: 'dist',
  banner: {
    js: `// Custom banner
import { createRequire as topLevelCreateRequire } from 'module';
const require = topLevelCreateRequire(import.meta.url);
`,
  },
  plugins: [esbuildPluginPino({ transports: ['pino-pretty'] })],
  logLevel: 'info',
})
