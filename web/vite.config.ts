import { fileURLToPath, URL } from 'node:url'
import type { Plugin, ViteDevServer } from 'vite'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(() => {
  async function readBody(req: NodeJS.ReadableStream): Promise<Buffer | undefined> {
    const chunks: Buffer[] = []
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return chunks.length ? Buffer.concat(chunks) : undefined
  }

  const rpcTunnel: Plugin = {
    name: 'fiber-rpc-tunnel',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/fiber-rpc', async (req, res) => {
        const requestUrl = new URL(req.url ?? '/', 'http://localhost')
        const target = requestUrl.searchParams.get('target')

        if (!target) {
          res.statusCode = 400
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Missing target query parameter for /fiber-rpc.' }))
          return
        }

        try {
          const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req)
          const upstream = await fetch(target, {
            method: req.method,
            headers: {
              'Content-Type': req.headers['content-type'] ?? 'application/json',
            },
            body: body ? new Uint8Array(body) : undefined,
          })

          res.statusCode = upstream.status
          res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json')
          res.end(await upstream.text())
        } catch (error) {
          res.statusCode = 502
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({
            error: 'Fiber RPC proxy failed.',
            detail: (error as Error).message,
            target,
          }))
        }
      })
    },
  }

  return {
    plugins: [react(), rpcTunnel],
    resolve: {
      alias: {
        '@channel-doctor': fileURLToPath(new URL('../src/index.ts', import.meta.url)),
      },
    },
    server: {
      fs: {
        allow: [fileURLToPath(new URL('..', import.meta.url))],
      },
      proxy: {},
    },
  }
})
