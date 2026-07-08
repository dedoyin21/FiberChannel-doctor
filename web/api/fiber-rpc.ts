type RequestLike = {
  method?: string
  query?: Record<string, string | string[] | undefined>
  headers: Record<string, string | string[] | undefined>
} & Partial<AsyncIterable<Uint8Array | string | Buffer>>

type ResponseLike = {
  status: (code: number) => ResponseLike
  setHeader: (name: string, value: string) => void
  send: (body: string) => void
}

function getTarget(req: RequestLike): URL {
  const raw = req.query?.target
  const value = Array.isArray(raw) ? raw[0] : raw
  if (!value) throw new Error('Missing target query parameter for RPC proxy.')

  const target = new URL(value)
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error(`Unsupported RPC target protocol: ${target.protocol}`)
  }

  return target
}

async function readBody(req: RequestLike): Promise<Buffer | undefined> {
  if (!req[Symbol.asyncIterator]) return undefined

  const chunks: Buffer[] = []
  const stream = req as AsyncIterable<Uint8Array | string | Buffer>
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return chunks.length ? Buffer.concat(chunks) : undefined
}

export default async function handler(req: RequestLike, res: ResponseLike): Promise<void> {
  res.setHeader('Cache-Control', 'no-store')

  try {
    const target = getTarget(req)
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req)
    const upstream = await fetch(target, {
      method: req.method ?? 'POST',
      headers: {
        'Content-Type': typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : 'application/json',
      },
      body: body ? new Uint8Array(body) : undefined,
    })

    res.status(upstream.status)
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json')
    res.send(await upstream.text())
  } catch (error) {
    res.status(502)
    res.setHeader('Content-Type', 'application/json')
    res.send(JSON.stringify({
      error: 'Fiber RPC proxy failed.',
      detail: (error as Error).message,
    }))
  }
}
