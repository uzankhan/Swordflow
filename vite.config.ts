import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: ['3000-iwzyq7qxm7yv45p1nnrq6-17948d4e.us3.manus.computer', '8328-iwzyq7qxm7yv45p1nnrq6-17948d4e.us3.manus.computer'],
  },
  preview: { host: '0.0.0.0', port: 3000, strictPort: true },
});
