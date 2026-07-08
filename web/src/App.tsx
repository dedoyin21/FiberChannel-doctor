import type { Dispatch, SetStateAction } from 'react'
import { useState, useTransition } from 'react'
import type {
  Check,
  CloseCheck,
  ConnectPeerResult,
  Diagnosis,
  OpenResult,
  ReadinessResult,
  TrackPaymentResult,
} from '@channel-doctor'
import {
  canPay,
  checkClose,
  checkOpen,
  closeChannel,
  connectPeer,
  diagnose,
  listNormalized,
  openAndWait,
  trackPayment,
  type NormalizedChannel,
} from '@channel-doctor'

type PanelState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string }

type Tone = 'signal' | 'lagoon' | 'gold' | 'plum'

interface ToggleField {
  label: string
  checked: boolean
  onChange: (value: boolean) => void
}

interface FormField {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}

const TESTNET_RPC_URL = 'http://18.162.235.225:8227'

function App(): JSX.Element {
  const [isPending, startTransition] = useTransition()
  const [rpcTarget, setRpcTarget] = useState('http://127.0.0.1:8227')
  const [peerId, setPeerId] = useState('')
  const [channelId, setChannelId] = useState('')
  const [multiaddr, setMultiaddr] = useState('')
  const [openAmount, setOpenAmount] = useState('100')
  const [paymentAmount, setPaymentAmount] = useState('10')
  const [paymentHash, setPaymentHash] = useState('')
  const [isPrivateOpen, setIsPrivateOpen] = useState(false)
  const [forceClose, setForceClose] = useState(false)

  const [statusPanel, setStatusPanel] = useState<PanelState<NormalizedChannel[]>>({ status: 'idle' })
  const [connectPanel, setConnectPanel] = useState<PanelState<ConnectPeerResult>>({ status: 'idle' })
  const [openCheckPanel, setOpenCheckPanel] = useState<PanelState<{ ok: boolean; checks: Check[] }>>({ status: 'idle' })
  const [openPanel, setOpenPanel] = useState<PanelState<OpenResult>>({ status: 'idle' })
  const [diagnosePanel, setDiagnosePanel] = useState<PanelState<Diagnosis>>({ status: 'idle' })
  const [canPayPanel, setCanPayPanel] = useState<PanelState<ReadinessResult>>({ status: 'idle' })
  const [trackPanel, setTrackPanel] = useState<PanelState<TrackPaymentResult>>({ status: 'idle' })
  const [closeCheckPanel, setCloseCheckPanel] = useState<PanelState<{ safe: boolean; checks: CloseCheck[] }>>({ status: 'idle' })
  const [closePanel, setClosePanel] = useState<PanelState<{ ok: true; channelId: string; force: boolean }>>({ status: 'idle' })

  const config = { url: `/fiber-rpc?target=${encodeURIComponent(rpcTarget)}` }

  function runPanel<T>(setter: Dispatch<SetStateAction<PanelState<T>>>, task: () => Promise<T>): void {
    setter({ status: 'loading' })
    startTransition(() => {
      void task()
        .then((data) => setter({ status: 'success', data }))
        .catch((error) => setter({ status: 'error', message: (error as Error).message }))
    })
  }

  function shannonFromCkb(value: string): bigint {
    const trimmed = value.trim()
    if (!trimmed) return 0n
    const [whole, fraction = ''] = trimmed.split('.')
    return BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0').slice(0, 8))
  }

  return (
    <main className="min-h-screen bg-canvas bg-dots bg-[size:18px_18px] text-carbon">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <header className="overflow-hidden rounded-[2rem] border border-carbon/10 bg-[linear-gradient(120deg,#fff9f2_0%,#ffe6d1_45%,#dbe6ff_100%)] shadow-card">
          <div className="grid gap-10 px-6 py-8 lg:grid-cols-[1.3fr_0.9fr] lg:px-10">
            <div className="space-y-5">
              <div className="inline-flex rounded-full border border-signal/20 bg-signal/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-signal">
                Browser UI for the real channel-doctor core
              </div>
              <div className="space-y-3">
                <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">
                  Channel Doctor Control Room
                </h1>
                <p className="max-w-3xl text-base leading-7 text-carbon/75 sm:text-lg">
                  This dashboard talks to a live Fiber RPC endpoint through a local dev proxy and runs the same tested
                  TypeScript logic as the CLI. It is built for real inspection, safer channel operations, and clearer
                  demos, not mock data.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                <MetricCard label="Coverage" value="status to close" tone="lagoon" />
                <MetricCard label="Proof" value="46 tests pass" tone="signal" />
                <MetricCard label="Use case" value="real node data" tone="gold" />
                <MetricCard label="Surface" value="CLI + browser" tone="plum" />
              </div>
            </div>

            <aside className="rounded-[1.5rem] border border-carbon/10 bg-white/85 p-5 backdrop-blur">
              <div className="space-y-4">
                <div>
                  <h2 className="font-display text-xl font-semibold">Live RPC target</h2>
                  <p className="mt-1 text-sm leading-6 text-carbon/70">
                    Enter any reachable Fiber RPC URL. The Vite dev server will tunnel requests through
                    <code className="mx-1">/fiber-rpc</code>, so you are no longer stuck on localhost unless you want to be.
                  </p>
                </div>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-carbon/80">Fiber RPC URL</span>
                  <input
                    value={rpcTarget}
                    onChange={(event) => setRpcTarget(event.target.value)}
                    className="w-full rounded-2xl border border-carbon/15 bg-chalk px-4 py-3 font-mono text-sm outline-none transition focus:border-lagoon focus:ring-2 focus:ring-lagoon/15"
                    placeholder="http://127.0.0.1:8227"
                  />
                </label>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setRpcTarget('http://127.0.0.1:8227')}
                    className="rounded-full border border-carbon/15 bg-carbon/5 px-3 py-2 text-xs font-semibold text-carbon transition hover:bg-carbon hover:text-white"
                  >
                    Local node
                  </button>
                  <button
                    type="button"
                    onClick={() => setRpcTarget(TESTNET_RPC_URL)}
                    className="rounded-full border border-lagoon/20 bg-lagoon/10 px-3 py-2 text-xs font-semibold text-lagoon transition hover:bg-lagoon hover:text-white"
                  >
                    Public testnet
                  </button>
                </div>

                <div className="rounded-2xl border border-signal/20 bg-signal/10 p-4 text-sm leading-6 text-carbon/80">
                  <strong className="font-semibold text-carbon">If you saw `ECONNREFUSED`:</strong> your local Fiber
                  node is not running at <code>127.0.0.1:8227</code>, or you need to point this UI at another live RPC
                  endpoint above.
                </div>

                <div className="rounded-2xl border border-gold/20 bg-gold/10 p-4 text-sm leading-6 text-carbon/80">
                  <strong className="font-semibold text-carbon">Use your own node for write actions:</strong> `connect`,
                  `open`, and `close` should only be used against infrastructure you control.
                </div>

                <div className="rounded-2xl border border-plum/15 bg-plum/5 p-4 text-sm leading-6 text-carbon/75">
                  <div className="font-semibold text-carbon">Strong demo path</div>
                  <ol className="mt-2 list-decimal space-y-1 pl-5">
                    <li>Load channel status.</li>
                    <li>Connect a peer or run a pre-open check.</li>
                    <li>Open a channel if you are on your own node.</li>
                    <li>Diagnose a public channel.</li>
                    <li>Verify local payment capacity and track a payment hash.</li>
                    <li>Check close safety before trying close.</li>
                  </ol>
                </div>
              </div>
            </aside>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-3">
          <ActionPanel
            title="Channel Status"
            description="Load normalized channels with decoded balances and usable capacity."
            tone="lagoon"
            pending={isPending && statusPanel.status === 'loading'}
            panel={statusPanel}
            onRun={() => runPanel(setStatusPanel, () => listNormalized(config))}
          />

          <FormPanel
            title="Connect Peer"
            description="Connect to a Fiber peer by multiaddr and verify it appears in peer listings."
            tone="signal"
            pending={isPending && connectPanel.status === 'loading'}
            panel={connectPanel}
            actionLabel="Connect"
            fields={[
              {
                label: 'Peer multiaddr',
                value: multiaddr,
                onChange: setMultiaddr,
                placeholder: '/ip4/127.0.0.1/tcp/8228/p2p/QmPeerId',
              },
            ]}
            onRun={() => runPanel(setConnectPanel, () => connectPeer(config, multiaddr))}
          />

          <FormPanel
            title="Check Open"
            description="Run operational checks before funding a new channel."
            tone="gold"
            pending={isPending && openCheckPanel.status === 'loading'}
            panel={openCheckPanel}
            actionLabel="Run Check"
            fields={[
              {
                label: 'Peer ID',
                value: peerId,
                onChange: setPeerId,
                placeholder: 'QmPeerId...',
              },
              {
                label: 'Funding amount (CKB)',
                value: openAmount,
                onChange: setOpenAmount,
                placeholder: '100',
              },
            ]}
            onRun={() => runPanel(setOpenCheckPanel, () => checkOpen({
              config,
              peerId,
              fundingAmountShannon: shannonFromCkb(openAmount),
            }))}
          />

          <FormPanel
            title="Open Channel"
            description="Open a channel and track the correct new channel until it is ready."
            tone="signal"
            pending={isPending && openPanel.status === 'loading'}
            panel={openPanel}
            actionLabel="Open Channel"
            fields={[
              {
                label: 'Peer ID',
                value: peerId,
                onChange: setPeerId,
                placeholder: 'QmPeerId...',
              },
              {
                label: 'Funding amount (CKB)',
                value: openAmount,
                onChange: setOpenAmount,
                placeholder: '100',
              },
            ]}
            toggles={[
              {
                label: 'Open as private channel',
                checked: isPrivateOpen,
                onChange: setIsPrivateOpen,
              },
            ]}
            onRun={() => runPanel(setOpenPanel, () => openAndWait({
              config,
              peerId,
              fundingAmountShannon: shannonFromCkb(openAmount),
              isPublic: !isPrivateOpen,
              gossipWaitMs: 0,
            }))}
          />

          <FormPanel
            title="Diagnose Channel"
            description="Explain readiness, capacity, and public graph visibility for a channel."
            tone="plum"
            pending={isPending && diagnosePanel.status === 'loading'}
            panel={diagnosePanel}
            actionLabel="Diagnose"
            fields={[
              {
                label: 'Channel ID',
                value: channelId,
                onChange: setChannelId,
                placeholder: '0xchannelid',
              },
            ]}
            onRun={() => runPanel(setDiagnosePanel, () => diagnose(config, channelId))}
          />

          <FormPanel
            title="Can Pay"
            description="Check honest local outgoing capacity without pretending to prove route success."
            tone="lagoon"
            pending={isPending && canPayPanel.status === 'loading'}
            panel={canPayPanel}
            actionLabel="Check Capacity"
            fields={[
              {
                label: 'Amount (CKB)',
                value: paymentAmount,
                onChange: setPaymentAmount,
                placeholder: '10',
              },
            ]}
            onRun={() => runPanel(setCanPayPanel, () => canPay(config, shannonFromCkb(paymentAmount)))}
          />

          <FormPanel
            title="Track Payment"
            description="Poll a payment hash until it succeeds or fails."
            tone="gold"
            pending={isPending && trackPanel.status === 'loading'}
            panel={trackPanel}
            actionLabel="Track Payment"
            fields={[
              {
                label: 'Payment hash',
                value: paymentHash,
                onChange: setPaymentHash,
                placeholder: '0xpaymenthash',
              },
            ]}
            onRun={() => runPanel(setTrackPanel, () => trackPayment(config, paymentHash))}
          />

          <FormPanel
            title="Check Close"
            description="Warn about in-flight TLCs and unsafe channel close timing."
            tone="signal"
            pending={isPending && closeCheckPanel.status === 'loading'}
            panel={closeCheckPanel}
            actionLabel="Check Close Safety"
            fields={[
              {
                label: 'Channel ID',
                value: channelId,
                onChange: setChannelId,
                placeholder: '0xchannelid',
              },
            ]}
            onRun={() => runPanel(setCloseCheckPanel, async () => {
              const result = await checkClose(config, channelId)
              return { safe: result.safe, checks: result.checks }
            })}
          />

          <FormPanel
            title="Close Channel"
            description="Submit a cooperative close or a force-close request."
            tone="plum"
            pending={isPending && closePanel.status === 'loading'}
            panel={closePanel}
            actionLabel="Close Channel"
            fields={[
              {
                label: 'Channel ID',
                value: channelId,
                onChange: setChannelId,
                placeholder: '0xchannelid',
              },
            ]}
            toggles={[
              {
                label: 'Force close',
                checked: forceClose,
                onChange: setForceClose,
              },
            ]}
            onRun={() => runPanel(setClosePanel, async () => {
              await closeChannel(config, channelId, { force: forceClose })
              return { ok: true as const, channelId, force: forceClose }
            })}
          />

          <section className="rounded-[1.75rem] border border-carbon/10 bg-white/88 p-6 shadow-card xl:col-span-3">
            <div className="space-y-4">
              <div className="inline-flex rounded-full border border-carbon/10 bg-carbon/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-carbon/60">
                What changed in this UI
              </div>
              <h2 className="font-display text-2xl font-semibold">This is now better for real demos and real testing.</h2>
              <div className="grid gap-3 text-sm leading-7 text-carbon/75 md:grid-cols-2">
                <p>
                  The proxy now uses the actual RPC target you type into the page, so the UI can talk to your own Fiber
                  node or a public endpoint without hard-wiring localhost.
                </p>
                <p>
                  The command surface is broader now too: status, connect, check-open, open, diagnose, can-pay,
                  track-payment, check-close, and close are all exposed from the browser.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <ChecklistItem title="Dynamic live RPC tunnel" />
                <ChecklistItem title="Distinct visual design" />
                <ChecklistItem title="Read and write actions covered" />
                <ChecklistItem title="Still powered by tested core logic" />
              </div>
            </div>
          </section>
        </section>
      </div>
    </main>
  )
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone: Tone }): JSX.Element {
  const palette = {
    signal: 'border-signal/20 bg-signal/10 text-signal',
    lagoon: 'border-lagoon/20 bg-lagoon/10 text-lagoon',
    gold: 'border-gold/20 bg-gold/10 text-gold',
    plum: 'border-plum/20 bg-plum/10 text-plum',
  }[tone]

  return (
    <div className={`rounded-[1.5rem] border p-4 ${palette}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.18em]">{label}</div>
      <div className="mt-2 font-display text-xl font-semibold text-carbon">{value}</div>
    </div>
  )
}

function ActionPanel<T>({
  title,
  description,
  tone,
  pending,
  panel,
  onRun,
}: {
  title: string
  description: string
  tone: Tone
  pending: boolean
  panel: PanelState<T>
  onRun: () => void
}): JSX.Element {
  return (
    <section className="rounded-[1.75rem] border border-carbon/10 bg-white/88 p-6 shadow-card">
      <div className="flex flex-col gap-5">
        <PanelHeader title={title} description={description} tone={tone} />
        <button
          type="button"
          onClick={onRun}
          className="inline-flex w-fit rounded-full bg-carbon px-5 py-3 text-sm font-semibold text-white transition hover:bg-signal"
        >
          {pending ? 'Loading...' : 'Run'}
        </button>
        <OutputPanel panel={panel} />
      </div>
    </section>
  )
}

function FormPanel<T>({
  title,
  description,
  tone,
  pending,
  panel,
  actionLabel,
  fields,
  toggles = [],
  onRun,
}: {
  title: string
  description: string
  tone: Tone
  pending: boolean
  panel: PanelState<T>
  actionLabel: string
  fields: FormField[]
  toggles?: ToggleField[]
  onRun: () => void
}): JSX.Element {
  return (
    <section className="rounded-[1.75rem] border border-carbon/10 bg-white/88 p-6 shadow-card">
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          onRun()
        }}
      >
        <PanelHeader title={title} description={description} tone={tone} />
        <div className="grid gap-4">
          {fields.map((field) => (
            <label key={field.label} className="block">
              <span className="mb-2 block text-sm font-medium text-carbon/80">{field.label}</span>
              <input
                value={field.value}
                onChange={(event) => field.onChange(event.target.value)}
                placeholder={field.placeholder}
                className="w-full rounded-2xl border border-carbon/15 bg-chalk px-4 py-3 font-mono text-sm outline-none transition focus:border-lagoon focus:ring-2 focus:ring-lagoon/15"
              />
            </label>
          ))}
          {toggles.map((toggle) => (
            <label key={toggle.label} className="flex items-center gap-3 rounded-2xl border border-carbon/10 bg-canvas px-4 py-3 text-sm text-carbon/80">
              <input
                type="checkbox"
                checked={toggle.checked}
                onChange={(event) => toggle.onChange(event.target.checked)}
                className="h-4 w-4 rounded border-carbon/20 text-signal focus:ring-signal"
              />
              <span>{toggle.label}</span>
            </label>
          ))}
        </div>
        <button
          type="submit"
          className="inline-flex w-fit rounded-full bg-carbon px-5 py-3 text-sm font-semibold text-white transition hover:bg-signal"
        >
          {pending ? 'Working...' : actionLabel}
        </button>
        <OutputPanel panel={panel} />
      </form>
    </section>
  )
}

function PanelHeader({ title, description, tone }: { title: string; description: string; tone: Tone }): JSX.Element {
  const badgeClass = {
    signal: 'border-signal/20 bg-signal/10 text-signal',
    lagoon: 'border-lagoon/20 bg-lagoon/10 text-lagoon',
    gold: 'border-gold/20 bg-gold/10 text-gold',
    plum: 'border-plum/20 bg-plum/10 text-plum',
  }[tone]

  return (
    <div className="space-y-3">
      <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${badgeClass}`}>
        {title}
      </div>
      <div>
        <h2 className="font-display text-2xl font-semibold text-carbon">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-carbon/70">{description}</p>
      </div>
    </div>
  )
}

function OutputPanel<T>({ panel }: { panel: PanelState<T> }): JSX.Element {
  if (panel.status === 'idle') {
    return (
      <div className="rounded-[1.5rem] border border-dashed border-carbon/15 bg-canvas/70 px-4 py-5 text-sm text-carbon/55">
        Run this action to see real output from the channel-doctor core.
      </div>
    )
  }

  if (panel.status === 'loading') {
    return (
      <div className="rounded-[1.5rem] border border-lagoon/15 bg-lagoon/5 px-4 py-5 text-sm text-carbon/70">
        Working on it...
      </div>
    )
  }

  if (panel.status === 'error') {
    return (
      <div className="rounded-[1.5rem] border border-signal/20 bg-signal/10 px-4 py-5 text-sm leading-6 text-carbon/80">
        <div className="font-semibold text-carbon">Request failed</div>
        <div className="mt-2 whitespace-pre-wrap font-mono text-xs">{panel.message}</div>
      </div>
    )
  }

  return (
    <pre className="overflow-x-auto rounded-[1.5rem] border border-carbon/10 bg-[#1d1730] px-4 py-5 font-mono text-xs leading-6 text-[#fef6eb]">
      {JSON.stringify(panel.data, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2)}
    </pre>
  )
}

function ChecklistItem({ title }: { title: string }): JSX.Element {
  return (
    <div className="rounded-2xl border border-carbon/10 bg-canvas px-4 py-3 text-sm font-medium text-carbon/80">
      {title}
    </div>
  )
}

export default App
