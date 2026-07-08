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

  function resolveRpcTarget(req: import('node:http').IncomingMessage): URL {
    const requestUrl = new URL(req.url ?? '/', 'http://localhost')
    const target = requestUrl.searchParams.get('target')
    if (!target) throw new Error('Missing target query parameter for RPC proxy.')

    const targetUrl = new URL(target)
    if (targetUrl.protocol !== 'http:' && targetUrl.protocol !== 'https:') {
      throw new Error(`Unsupported RPC target protocol: ${targetUrl.protocol}`)
    }

    return targetUrl
  }

  const rpcTunnel: Plugin = {
    name: 'fiber-rpc-tunnel',
    configureServer(server: ViteDevServer) {
      const handler = async (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
        try {
          const targetUrl = resolveRpcTarget(req)
          const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req)
          const upstream = await fetch(targetUrl, {
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
            target: (() => {
              try {
                return resolveRpcTarget(req).toString()
              } catch {
                return null
              }
            })(),
          }))
        }
      }

      server.middlewares.use('/api/fiber-rpc', handler)
      server.middlewares.use('/fiber-rpc', handler)
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
