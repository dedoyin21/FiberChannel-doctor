type RequestLike = {
    method?: string;
    query?: Record<string, string | string[] | undefined>;
    headers: Record<string, string | string[] | undefined>;
} & Partial<AsyncIterable<Uint8Array | string | Buffer>>;
type ResponseLike = {
    status: (code: number) => ResponseLike;
    setHeader: (name: string, value: string) => void;
    send: (body: string) => void;
};
export default function handler(req: RequestLike, res: ResponseLike): Promise<void>;
export {};
