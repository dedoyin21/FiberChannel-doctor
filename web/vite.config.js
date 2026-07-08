import { fileURLToPath, URL } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(function (_a) {
    var mode = _a.mode;
    var env = loadEnv(mode, process.cwd(), '');
    var rpcProxyTarget = env.FIBER_RPC_PROXY_TARGET || 'http://127.0.0.1:8227';
    return {
        plugins: [react()],
        resolve: {
            alias: {
                '@channel-doctor': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
            },
        },
        server: {
            fs: {
                allow: [fileURLToPath(new URL('..', import.meta.url))],
            },
            proxy: {
                '/rpc': {
                    target: rpcProxyTarget,
                    changeOrigin: true,
                },
            },
        },
    };
});
