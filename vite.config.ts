import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const gatewayTarget = process.env.AI_GW_DEV_PROXY_TARGET || 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/backend/**'] },
    proxy: Object.fromEntries(
      ['/account-api/', '/admin/', '/payments/', '/shortcuts/', '/v1/', '/app-config'].map((prefix) => [
        prefix,
        { target: gatewayTarget }
      ])
    )
  }
});
