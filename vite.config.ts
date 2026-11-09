import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => {
  if (mode === 'demo') {
    // Demo page, deployed to GitHub Pages.
    return {
      root: 'demo',
      base: './',
      build: {
        outDir: '../site',
        emptyOutDir: true,
      },
    }
  }

  // Library build, published to npm.
  return {
    build: {
      target: 'es2022',
      lib: {
        entry: 'src/codejar.ts',
        formats: ['es'],
        fileName: 'codejar',
      },
      minify: false,
      sourcemap: true,
      emptyOutDir: true,
    },
  }
})
