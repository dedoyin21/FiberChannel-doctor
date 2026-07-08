import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { useEffect, useState, useTransition } from 'react'
import type {
  Check,
  CloseCheck,
  ConnectPeerResult,
  Diagnosis,
  OpenResult,
  ReadinessResult,
  RpcConfig,
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
type View = 'dashboard' | 'docs'

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

interface DashboardState {
  rpcTarget: string
  peerId: string
  channelId: string
  multiaddr: string
  openAmount: string
  paymentAmount: string
  paymentHash: string
  isPrivateOpen: boolean
  forceClose: boolean
}

const TESTNET_RPC_URL = 'http://18.162.235.225:8227'
const DEFAULT_RPC_URL = 'http://127.0.0.1:8227'
const DASHBOARD_PATH = '/dashboard'
const DOCS_PATH = '/dashboard/docs'

const COMMANDS = [
  {
    name: 'status',
    args: '',
    description: 'List normalized channels with decoded balances and usable capacity.',
  },
  {
    name: 'connect',
    args: '<multiaddr>',
    description: 'Connect to a Fiber peer using a complete multiaddr ending in /p2p/<peerId>.',
  },
  {
    name: 'check-open',
    args: '<peerId> <amountCKB>',
    description: 'Run pre-open checks before funding a channel.',
  },
  {
    name: 'open',
    args: '<peerId> <amountCKB> [--private]',
    description: 'Open a channel and track the right new channel until CHANNEL_READY.',
  },
  {
    name: 'diagnose',
    args: '<channelId>',
    description: 'Explain a channel state, capacity, and public graph visibility.',
  },
  {
    name: 'can-pay',
    args: '<amountCKB>',
    description: 'Check whether local channel liquidity can carry a payment amount.',
  },
  {
    name: 'track-payment',
    args: '<paymentHash>',
    description: 'Poll a payment until success or failure.',
  },
  {
    name: 'check-close',
    args: '<channelId>',
    description: 'Warn before close when TLCs or state make closure unsafe.',
  },
  {
    name: 'close',
    args: '<channelId> [--force]',
    description: 'Request a cooperative close or force-close.',
  },
] as const

const RPC_METHODS = [
  { method: 'node_info', purpose: 'Read node identity, addresses, and readiness.' },
  { method: 'list_peers', purpose: 'Inspect connected peers after connect attempts.' },
  { method: 'connect_peer', purpose: 'Connect to a remote Fiber peer by multiaddr.' },
  { method: 'list_channels', purpose: 'Load channels for status, open tracking, and diagnostics.' },
  { method: 'open_channel', purpose: 'Create a new channel against a selected peer.' },
  { method: 'graph_channels', purpose: 'Check whether a public channel has propagated into the network graph.' },
  { method: 'get_payment', purpose: 'Track payment status over time.' },
  { method: 'close_channel', purpose: 'Submit a close request.' },
] as const

const EXAMPLES = {
  status: `node dist/cli/index.js status --rpc-url ${DEFAULT_RPC_URL} --json`,
  connect: 'node dist/cli/index.js connect /ip4/127.0.0.1/tcp/8228/p2p/QmPeerId',
  checkOpen: 'node dist/cli/index.js check-open QmPeerId 100',
  open: 'node dist/cli/index.js open QmPeerId 100',
  diagnose: 'node dist/cli/index.js diagnose 0xchannelid',
  canPay: 'node dist/cli/index.js can-pay 10',
} as const

function App(): JSX.Element {
  const [view, setView] = useState<View>(() => viewFromPathname(window.location.pathname))
  const [dashboardState, setDashboardState] = useState<DashboardState>({
    rpcTarget: DEFAULT_RPC_URL,
    peerId: '',
    channelId: '',
    multiaddr: '',
    openAmount: '100',
    paymentAmount: '10',
    paymentHash: '',
    isPrivateOpen: false,
    forceClose: false,
  })

  useEffect(() => {
    const normalized = normalizePathname(window.location.pathname)
    const expected = pathForView(view)

    if (normalized === '/') {
      window.history.replaceState({}, '', expected)
    }

    function handlePopState(): void {
      setView(viewFromPathname(window.location.pathname))
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [view])

  function navigate(nextView: View): void {
    const nextPath = pathForView(nextView)
    if (normalizePathname(window.location.pathname) !== nextPath) {
      window.history.pushState({}, '', nextPath)
    }
    setView(nextView)
  }

  return (
    <main className="min-h-screen bg-canvas bg-dots bg-[size:18px_18px] text-carbon">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <TopNavigation view={view} onChange={navigate} />
        {view === 'dashboard' ? (
          <DashboardPage state={dashboardState} setState={setDashboardState} onOpenDocs={() => navigate('docs')} />
        ) : (
          <DocsPage rpcTarget={dashboardState.rpcTarget} onOpenDashboard={() => navigate('dashboard')} />
        )}
      </div>
    </main>
  )
}

function TopNavigation({ view, onChange }: { view: View; onChange: (view: View) => void }): JSX.Element {
  return (
    <nav className="flex flex-wrap items-center justify-between gap-4 rounded-[1.75rem] border border-carbon/10 bg-white/80 px-5 py-4 shadow-card backdrop-blur">
      <div>
        <div className="font-display text-2xl font-extrabold tracking-tight">Channel Doctor</div>
        <div className="text-sm text-carbon/65">Fiber diagnostics, channel ops, and reusable developer tooling.</div>
      </div>
      <div className="flex rounded-full border border-carbon/10 bg-canvas p-1">
        <NavButton active={view === 'dashboard'} onClick={() => onChange('dashboard')}>
          Dashboard
        </NavButton>
        <NavButton active={view === 'docs'} onClick={() => onChange('docs')}>
          Documentation / API
        </NavButton>
      </div>
    </nav>
  )
}

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
        active
          ? 'bg-carbon text-white shadow-[0_10px_24px_rgba(23,19,28,0.16)]'
          : 'text-carbon/70 hover:bg-white hover:text-carbon'
      }`}
    >
      {children}
    </button>
  )
}

function DashboardPage({
  state,
  setState,
  onOpenDocs,
}: {
  state: DashboardState
  setState: Dispatch<SetStateAction<DashboardState>>
  onOpenDocs: () => void
}): JSX.Element {
  const [isPending, startTransition] = useTransition()
  const [statusPanel, setStatusPanel] = useState<PanelState<NormalizedChannel[]>>({ status: 'idle' })
  const [connectPanel, setConnectPanel] = useState<PanelState<ConnectPeerResult>>({ status: 'idle' })
  const [openCheckPanel, setOpenCheckPanel] = useState<PanelState<{ ok: boolean; checks: Check[] }>>({ status: 'idle' })
  const [openPanel, setOpenPanel] = useState<PanelState<OpenResult>>({ status: 'idle' })
  const [diagnosePanel, setDiagnosePanel] = useState<PanelState<Diagnosis>>({ status: 'idle' })
  const [canPayPanel, setCanPayPanel] = useState<PanelState<ReadinessResult>>({ status: 'idle' })
  const [trackPanel, setTrackPanel] = useState<PanelState<TrackPaymentResult>>({ status: 'idle' })
  const [closeCheckPanel, setCloseCheckPanel] = useState<PanelState<{ safe: boolean; checks: CloseCheck[] }>>({ status: 'idle' })
  const [closePanel, setClosePanel] = useState<PanelState<{ ok: true; channelId: string; force: boolean }>>({ status: 'idle' })

  const config: RpcConfig = { url: `/api/fiber-rpc?target=${encodeURIComponent(state.rpcTarget)}` }

  function patchState(patch: Partial<DashboardState>): void {
    setState((current) => ({ ...current, ...patch }))
  }

  function runPanel<T>(setter: Dispatch<SetStateAction<PanelState<T>>>, task: () => Promise<T>): void {
    setter({ status: 'loading' })
    startTransition(() => {
      void task()
        .then((data) => setter({ status: 'success', data }))
        .catch((error) => setter({ status: 'error', message: (error as Error).message }))
    })
  }

  return (
    <>
      <header className="overflow-hidden rounded-[2rem] border border-carbon/10 bg-[linear-gradient(120deg,#fff9f2_0%,#ffe6d1_45%,#dbe6ff_100%)] shadow-card">
        <div className="grid gap-10 px-6 py-8 lg:grid-cols-[1.3fr_0.9fr] lg:px-10">
          <div className="space-y-5">
            <div className="inline-flex rounded-full border border-signal/20 bg-signal/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-signal">
              Live Fiber dashboard
            </div>
            <div className="space-y-3">
              <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Channel Doctor Dashboard</h1>
              <p className="max-w-3xl text-base leading-7 text-carbon/75 sm:text-lg">Run Fiber status, connect, open, diagnose, track, and close checks from one page.</p>
            </div>
            
          </div>

          <aside className="rounded-[1.5rem] border border-carbon/10 bg-white/85 p-5 backdrop-blur">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-display text-xl font-semibold">Live RPC target</h2>
                  <p className="mt-1 text-sm leading-6 text-carbon/70">Point this page to any reachable Fiber RPC URL.</p>
                </div>
                <button
                  type="button"
                  onClick={onOpenDocs}
                  className="rounded-full border border-plum/20 bg-plum/10 px-3 py-2 text-xs font-semibold text-plum transition hover:bg-plum hover:text-white"
                >
                  Open docs
                </button>
              </div>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-carbon/80">Fiber RPC URL</span>
                <input
                  value={state.rpcTarget}
                  onChange={(event) => patchState({ rpcTarget: event.target.value })}
                  className="w-full rounded-2xl border border-carbon/15 bg-chalk px-4 py-3 font-mono text-sm outline-none transition focus:border-lagoon focus:ring-2 focus:ring-lagoon/15"
                  placeholder={DEFAULT_RPC_URL}
                />
              </label>

              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => patchState({ rpcTarget: DEFAULT_RPC_URL })}
                  className="rounded-full border border-carbon/15 bg-carbon/5 px-3 py-2 text-xs font-semibold text-carbon transition hover:bg-carbon hover:text-white"
                >
                  Local node
                </button>
                <button
                  type="button"
                  onClick={() => patchState({ rpcTarget: TESTNET_RPC_URL })}
                  className="rounded-full border border-lagoon/20 bg-lagoon/10 px-3 py-2 text-xs font-semibold text-lagoon transition hover:bg-lagoon hover:text-white"
                >
                  Public testnet
                </button>
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
              value: state.multiaddr,
              onChange: (value) => patchState({ multiaddr: value }),
              placeholder: '/ip4/127.0.0.1/tcp/8228/p2p/QmPeerId',
            },
          ]}
          onRun={() => runPanel(setConnectPanel, () => connectPeer(config, state.multiaddr))}
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
              value: state.peerId,
              onChange: (value) => patchState({ peerId: value }),
              placeholder: 'QmPeerId...',
            },
            {
              label: 'Funding amount (CKB)',
              value: state.openAmount,
              onChange: (value) => patchState({ openAmount: value }),
              placeholder: '100',
            },
          ]}
          onRun={() => runPanel(setOpenCheckPanel, () => checkOpen({
            config,
            peerId: state.peerId,
            fundingAmountShannon: shannonFromCkb(state.openAmount),
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
              value: state.peerId,
              onChange: (value) => patchState({ peerId: value }),
              placeholder: 'QmPeerId...',
            },
            {
              label: 'Funding amount (CKB)',
              value: state.openAmount,
              onChange: (value) => patchState({ openAmount: value }),
              placeholder: '100',
            },
          ]}
          toggles={[
            {
              label: 'Open as private channel',
              checked: state.isPrivateOpen,
              onChange: (value) => patchState({ isPrivateOpen: value }),
            },
          ]}
          onRun={() => runPanel(setOpenPanel, () => openAndWait({
            config,
            peerId: state.peerId,
            fundingAmountShannon: shannonFromCkb(state.openAmount),
            isPublic: !state.isPrivateOpen,
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
              value: state.channelId,
              onChange: (value) => patchState({ channelId: value }),
              placeholder: '0xchannelid',
            },
          ]}
          onRun={() => runPanel(setDiagnosePanel, () => diagnose(config, state.channelId))}
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
              value: state.paymentAmount,
              onChange: (value) => patchState({ paymentAmount: value }),
              placeholder: '10',
            },
          ]}
          onRun={() => runPanel(setCanPayPanel, () => canPay(config, shannonFromCkb(state.paymentAmount)))}
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
              value: state.paymentHash,
              onChange: (value) => patchState({ paymentHash: value }),
              placeholder: '0xpaymenthash',
            },
          ]}
          onRun={() => runPanel(setTrackPanel, () => trackPayment(config, state.paymentHash))}
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
              value: state.channelId,
              onChange: (value) => patchState({ channelId: value }),
              placeholder: '0xchannelid',
            },
          ]}
          onRun={() => runPanel(setCloseCheckPanel, async () => {
            const result = await checkClose(config, state.channelId)
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
              value: state.channelId,
              onChange: (value) => patchState({ channelId: value }),
              placeholder: '0xchannelid',
            },
          ]}
          toggles={[
            {
              label: 'Force close',
              checked: state.forceClose,
              onChange: (value) => patchState({ forceClose: value }),
            },
          ]}
          onRun={() => runPanel(setClosePanel, async () => {
            await closeChannel(config, state.channelId, { force: state.forceClose })
            return { ok: true as const, channelId: state.channelId, force: state.forceClose }
          })}
        />

        <section className="grid gap-3 xl:col-span-3 sm:grid-cols-2 lg:grid-cols-4">
          <ChecklistItem title="Dynamic RPC target" />
          <ChecklistItem title="Real Fiber output" />
          <ChecklistItem title="Read and write actions" />
          <ChecklistItem title="Shared CLI core" />
        </section>
      </section>
    </>
  )
}

function DocsPage({ rpcTarget, onOpenDashboard }: { rpcTarget: string; onOpenDashboard: () => void }): JSX.Element {
  return (
    <>
      <header className="overflow-hidden rounded-[2rem] border border-carbon/10 bg-[linear-gradient(135deg,#fdf2de_0%,#fffaf4_35%,#dce8ff_100%)] shadow-card">
        <div className="grid gap-8 px-6 py-8 lg:grid-cols-[1.25fr_0.95fr] lg:px-10">
          <div className="space-y-5">
            <div className="inline-flex rounded-full border border-lagoon/20 bg-lagoon/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-lagoon">
              Docs and API
            </div>
            <div className="space-y-3">
              <h1 className="font-display text-4xl font-extrabold tracking-tight sm:text-5xl">Channel Doctor Docs</h1>
              <p className="max-w-3xl text-base leading-7 text-carbon/75 sm:text-lg">Commands, API surface, and Fiber RPC mapping.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <MetricCard label="Runtime" value="TypeScript core" tone="plum" />
              <MetricCard label="Transport" value="JSON-RPC" tone="lagoon" />
              <MetricCard label="Current target" value={shortRpcTarget(rpcTarget)} tone="gold" />
            </div>
          </div>

          <aside className="rounded-[1.5rem] border border-carbon/10 bg-white/85 p-5 backdrop-blur">
            <div className="space-y-4">
              <div className="rounded-2xl border border-plum/15 bg-plum/5 p-4 text-sm leading-6 text-carbon/75">
                <div className="font-semibold text-carbon">Category</div>
                <p className="mt-2">Node, Routing, Cross-chain, and Diagnostics Infrastructure.</p>
              </div>
              <button
                type="button"
                onClick={onOpenDashboard}
                className="rounded-full bg-carbon px-4 py-3 text-sm font-semibold text-white transition hover:bg-signal"
              >
                Back to dashboard
              </button>
            </div>
          </aside>
        </div>
      </header>

      <section className="grid gap-6 xl:grid-cols-[1.05fr_1.05fr_0.9fr]">
        <ContentCard
          title="Quick Start"
          tone="signal"
          description="Start fast."
        >
          <NumberedList
            items={[
              'Run `npm install` in the repo root and `npm run build`.',
              'Start the browser UI with `cd web` and `npm run dev`.',
              `Point the RPC target to your node, usually \`${DEFAULT_RPC_URL}\`.`,
              'Open the dashboard and run the action you need.',
            ]}
          />
        </ContentCard>

        <ContentCard
          title="API Surface"
          tone="lagoon"
          description="Shared by the CLI and dashboard."
        >
          <div className="grid gap-3">
            {COMMANDS.map((command) => (
              <MethodRow
                key={command.name}
                name={command.name}
                detail={command.args || 'no args'}
                description={command.description}
              />
            ))}
          </div>
        </ContentCard>

        <ContentCard
          title="Fiber RPC Mapping"
          tone="gold"
          description="Main upstream methods."
        >
          <div className="grid gap-3">
            {RPC_METHODS.map((item) => (
              <MethodRow key={item.method} name={item.method} detail="Fiber RPC" description={item.purpose} compact />
            ))}
          </div>
        </ContentCard>

        <ContentCard
          title="Command Examples"
          tone="plum"
          description="Click copy and run."
          className="xl:col-span-2"
        >
          <CodeExample label="Status" code={EXAMPLES.status} />
          <CodeExample label="Connect" code={EXAMPLES.connect} />
          <CodeExample label="Check Open" code={EXAMPLES.checkOpen} />
          <CodeExample label="Open" code={EXAMPLES.open} />
          <CodeExample label="Diagnose" code={EXAMPLES.diagnose} />
          <CodeExample label="Can Pay" code={EXAMPLES.canPay} />
        </ContentCard>

        <ContentCard
          title="Notes"
          tone="signal"
          description="Straight to the point."
        >
          <BulletList
            items={[
              'Dashboard calls the shared TypeScript core, which calls Fiber RPC through the dev proxy.',
              'Open tracking follows the newly opened channel instead of guessing.',
              'Capacity checks are local liquidity checks, not full route proof.',
              'Best fit today: operator tooling and diagnostics infrastructure.',
            ]}
          />
        </ContentCard>

        <ContentCard
          title="Who can use it"
          tone="lagoon"
          description="Reusable integration targets."
          className="xl:col-span-3"
        >
          <div className="grid gap-4 md:grid-cols-3">
            <MiniNote
              title="Wallets"
              text="Reuse pre-open checks, capacity checks, and payment tracking."
            />
            <MiniNote
              title="Services"
              text="Use diagnostics and JSON output in monitoring and support tooling."
            />
            <MiniNote
              title="Node operators"
              text="Use the UI for live checks and the CLI for scripts and runbooks."
            />
          </div>
        </ContentCard>
      </section>
    </>
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

function ContentCard({
  title,
  tone,
  description,
  className = '',
  children,
}: {
  title: string
  tone: Tone
  description: string
  className?: string
  children: ReactNode
}): JSX.Element {
  return (
    <section className={`rounded-[1.75rem] border border-carbon/10 bg-white/88 p-6 shadow-card ${className}`.trim()}>
      <div className="space-y-5">
        <PanelHeader title={title} description={description} tone={tone} />
        <div className="space-y-4">{children}</div>
      </div>
    </section>
  )
}

function MethodRow({
  name,
  detail,
  description,
  compact = false,
}: {
  name: string
  detail: string
  description: string
  compact?: boolean
}): JSX.Element {
  return (
    <div className="rounded-2xl border border-carbon/10 bg-canvas/80 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-full bg-carbon px-2.5 py-1 text-xs font-semibold text-white">{name}</code>
        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-carbon/45">{detail}</span>
      </div>
      <p className={`mt-3 text-carbon/72 ${compact ? 'text-sm leading-6' : 'text-sm leading-7'}`}>{description}</p>
    </div>
  )
}

function CodeExample({ label, code }: { label: string; code: string }): JSX.Element {
  const [copied, setCopied] = useState(false)

  async function handleCopy(): Promise<void> {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code)
      } else {
        const textarea = document.createElement('textarea')
        textarea.value = code
        textarea.setAttribute('readonly', 'true')
        textarea.style.position = 'absolute'
        textarea.style.left = '-9999px'
        document.body.appendChild(textarea)
        textarea.select()
        document.execCommand('copy')
        document.body.removeChild(textarea)
      }

      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-[0.16em] text-carbon/45">{label}</div>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-2 rounded-full border border-carbon/10 bg-white px-3 py-1.5 text-xs font-semibold text-carbon transition hover:border-plum/30 hover:bg-plum/10"
          aria-label={`Copy ${label} command`}
        >
          <CopyIcon />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-2xl border border-carbon/10 bg-[#201735] px-4 py-4 font-mono text-xs leading-6 text-[#fef6eb]">
        {code}
      </pre>
    </div>
  )
}

function CopyIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-none stroke-current stroke-2">
      <rect x="9" y="9" width="10" height="10" rx="2" />
      <path d="M5 15V7a2 2 0 0 1 2-2h8" />
    </svg>
  )
}

function MiniNote({ title, text }: { title: string; text: string }): JSX.Element {
  return (
    <div className="rounded-2xl border border-carbon/10 bg-canvas/80 p-4">
      <div className="font-display text-xl font-semibold text-carbon">{title}</div>
      <p className="mt-2 text-sm leading-7 text-carbon/72">{text}</p>
    </div>
  )
}

function BulletList({ items }: { items: string[] }): JSX.Element {
  return (
    <ul className="space-y-3 text-sm leading-7 text-carbon/75">
      {items.map((item) => (
        <li key={item} className="rounded-2xl border border-carbon/10 bg-canvas/80 px-4 py-3">
          {item}
        </li>
      ))}
    </ul>
  )
}

function NumberedList({ items }: { items: string[] }): JSX.Element {
  return (
    <ol className="space-y-3 text-sm leading-7 text-carbon/75">
      {items.map((item, index) => (
        <li key={item} className="flex gap-3 rounded-2xl border border-carbon/10 bg-canvas/80 px-4 py-3">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-carbon text-xs font-semibold text-white">
            {index + 1}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  )
}

function shortRpcTarget(value: string): string {
  return value.length > 26 ? `${value.slice(0, 23)}...` : value
}

function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/'
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
}

function viewFromPathname(pathname: string): View {
  const normalized = normalizePathname(pathname)
  if (normalized === DOCS_PATH || normalized === '/docs') return 'docs'
  return 'dashboard'
}

function pathForView(view: View): string {
  return view === 'docs' ? DOCS_PATH : DASHBOARD_PATH
}

function shannonFromCkb(value: string): bigint {
  const trimmed = value.trim()
  if (!trimmed) return 0n
  const [whole, fraction = ''] = trimmed.split('.')
  return BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0').slice(0, 8))
}

export default App
