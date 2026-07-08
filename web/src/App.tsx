import type { Dispatch, SetStateAction } from 'react'
import { useState, useTransition } from 'react'
import type { Check, CloseCheck, Diagnosis, NormalizedChannel, ReadinessResult } from '@channel-doctor'
import { canPay, checkClose, checkOpen, diagnose, listNormalized } from '@channel-doctor'

type PanelState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; message: string }

function App(): JSX.Element {
  const [isPending, startTransition] = useTransition()
  const [rpcUrl, setRpcUrl] = useState('/rpc')
  const [peerId, setPeerId] = useState('')
  const [channelId, setChannelId] = useState('')
  const [openAmount, setOpenAmount] = useState('100')
  const [paymentAmount, setPaymentAmount] = useState('10')

  const [statusPanel, setStatusPanel] = useState<PanelState<NormalizedChannel[]>>({ status: 'idle' })
  const [openCheckPanel, setOpenCheckPanel] = useState<PanelState<{ ok: boolean; checks: Check[] }>>({ status: 'idle' })
  const [diagnosePanel, setDiagnosePanel] = useState<PanelState<Diagnosis>>({ status: 'idle' })
  const [canPayPanel, setCanPayPanel] = useState<PanelState<ReadinessResult>>({ status: 'idle' })
  const [closePanel, setClosePanel] = useState<PanelState<{ safe: boolean; checks: CloseCheck[] }>>({ status: 'idle' })

  const config = { url: rpcUrl }

  function runPanel<T>(
    setter: Dispatch<SetStateAction<PanelState<T>>>,
    task: () => Promise<T>,
  ): void {
    setter({ status: 'loading' })
    startTransition(() => {
      void task()
        .then((data) => setter({ status: 'success', data }))
        .catch((error) => setter({ status: 'error', message: (error as Error).message }))
    })
  }

  function shannonFromCkb(value: string): bigint {
    const [whole, fraction = ''] = value.trim().split('.')
    if (!whole) return 0n
    return BigInt(whole) * 100_000_000n + BigInt(fraction.padEnd(8, '0').slice(0, 8))
  }

  return (
    <main className="min-h-screen bg-paper bg-grid bg-[size:24px_24px] text-ink">
      <div className="mx-auto flex min-h-screen max-w-7xl flex-col gap-8 px-4 py-6 sm:px-6 lg:px-8">
        <header className="overflow-hidden rounded-[2rem] border border-white/70 bg-gradient-to-br from-cream via-white to-[#e8f4f0] shadow-card">
          <div className="grid gap-10 px-6 py-8 lg:grid-cols-[1.4fr_0.8fr] lg:px-10">
            <div className="space-y-5">
              <div className="inline-flex rounded-full border border-pine/20 bg-pine/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-pine">
                Fiber diagnostics and channel operations
              </div>
              <div className="space-y-3">
                <h1 className="font-display text-4xl font-bold tracking-tight text-ink sm:text-5xl">
                  Channel Doctor UI
                </h1>
                <p className="max-w-3xl text-base leading-7 text-ink/75 sm:text-lg">
                  A visual control room for the real <code>channel-doctor</code> toolkit. Use it to inspect channels,
                  run pre-flight checks, diagnose readiness, and verify local outgoing capacity without dropping down to
                  raw RPC responses.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <MetricCard label="Backed by" value="46 passing tests" tone="pine" />
                <MetricCard label="Best fit" value="Diagnostics infra" tone="ocean" />
                <MetricCard label="Output" value="Human + JSON" tone="ember" />
              </div>
            </div>

            <aside className="rounded-[1.5rem] border border-ink/10 bg-white/80 p-5 backdrop-blur">
              <div className="space-y-4">
                <div>
                  <h2 className="font-display text-xl font-semibold">Connection</h2>
                  <p className="mt-1 text-sm leading-6 text-ink/70">
                    Use <code>/rpc</code> for local Vite proxy mode, or enter a direct Fiber RPC URL if your node allows
                    browser access.
                  </p>
                </div>

                <label className="block">
                  <span className="mb-2 block text-sm font-medium text-ink/80">Fiber RPC URL</span>
                  <input
                    value={rpcUrl}
                    onChange={(event) => setRpcUrl(event.target.value)}
                    className="w-full rounded-2xl border border-ink/15 bg-cream px-4 py-3 font-mono text-sm outline-none transition focus:border-pine focus:ring-2 focus:ring-pine/15"
                    placeholder="/rpc"
                  />
                </label>

                <div className="rounded-2xl border border-ember/20 bg-ember/10 p-4 text-sm leading-6 text-ink/80">
                  <strong className="font-semibold text-ink">Local dev note:</strong> set{' '}
                  <code>FIBER_RPC_PROXY_TARGET</code> before running Vite if you want <code>/rpc</code> to proxy to a
                  local or remote Fiber node.
                </div>

                <div className="rounded-2xl border border-pine/15 bg-pine/5 p-4 text-sm leading-6 text-ink/75">
                  <div className="font-semibold text-ink">Recommended demo flow</div>
                  <ol className="mt-2 list-decimal space-y-1 pl-5">
                    <li>Load channel status.</li>
                    <li>Run a pre-open safety check.</li>
                    <li>Diagnose a public channel.</li>
                    <li>Test local outgoing capacity.</li>
                    <li>Check whether close is safe.</li>
                  </ol>
                </div>
              </div>
            </aside>
          </div>
        </header>

        <section className="grid gap-6 xl:grid-cols-2">
          <ActionPanel
            title="Channel Status"
            description="List channels with decoded balances and usable capacity."
            tone="pine"
            pending={isPending && statusPanel.status === 'loading'}
            panel={statusPanel}
            onRun={() => runPanel(setStatusPanel, () => listNormalized(config))}
          />

          <FormPanel
            title="Check Open"
            description="Run pre-open checks before funding a new channel."
            tone="ember"
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
            title="Diagnose Channel"
            description="Explain channel readiness and public graph visibility."
            tone="ocean"
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
            description="Check local outgoing capacity without overclaiming route success."
            tone="pine"
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
            title="Check Close"
            description="Warn about in-flight TLCs and unsafe close timing."
            tone="ember"
            pending={isPending && closePanel.status === 'loading'}
            panel={closePanel}
            actionLabel="Check Close Safety"
            fields={[
              {
                label: 'Channel ID',
                value: channelId,
                onChange: setChannelId,
                placeholder: '0xchannelid',
              },
            ]}
            onRun={() => runPanel(setClosePanel, async () => {
              const result = await checkClose(config, channelId)
              return { safe: result.safe, checks: result.checks }
            })}
          />

          <section className="rounded-[1.75rem] border border-white/80 bg-white/85 p-6 shadow-card">
            <div className="space-y-4">
              <div className="inline-flex rounded-full border border-ink/10 bg-ink/5 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-ink/60">
                Why this UI matters
              </div>
              <h2 className="font-display text-2xl font-semibold">This is still the same real infrastructure.</h2>
              <div className="space-y-3 text-sm leading-7 text-ink/75">
                <p>
                  The UI is not replacing the CLI. It is a visual layer on top of the same tested TypeScript core.
                </p>
                <p>
                  That means the project can now serve three kinds of users at once: terminal-first operators,
                  developers who want importable helpers, and judges or teams who need a browser-based demo.
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <ChecklistItem title="CLI core stays reusable" />
                <ChecklistItem title="Visual demo becomes easy" />
                <ChecklistItem title="JSON output still works for bots" />
                <ChecklistItem title="Hackathon story gets easier to show" />
              </div>
            </div>
          </section>
        </section>
      </div>
    </main>
  )
}

interface MetricCardProps {
  label: string
  tone: 'pine' | 'ocean' | 'ember'
  value: string
}

function MetricCard({ label, tone, value }: MetricCardProps): JSX.Element {
  const palette = {
    pine: 'border-pine/20 bg-pine/10 text-pine',
    ocean: 'border-ocean/20 bg-ocean/10 text-ocean',
    ember: 'border-ember/20 bg-ember/10 text-ember',
  }[tone]

  return (
    <div className={`rounded-[1.5rem] border p-4 ${palette}`}>
      <div className="text-xs font-semibold uppercase tracking-[0.18em]">{label}</div>
      <div className="mt-2 font-display text-xl font-semibold text-ink">{value}</div>
    </div>
  )
}

interface ActionPanelProps<T> {
  title: string
  description: string
  tone: 'pine' | 'ocean' | 'ember'
  pending: boolean
  panel: PanelState<T>
  onRun: () => void
}

function ActionPanel<T>({ title, description, tone, pending, panel, onRun }: ActionPanelProps<T>): JSX.Element {
  return (
    <section className="rounded-[1.75rem] border border-white/80 bg-white/85 p-6 shadow-card">
      <div className="flex flex-col gap-5">
        <PanelHeader title={title} description={description} tone={tone} />
        <button
          type="button"
          onClick={onRun}
          className="inline-flex w-fit rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-pine"
        >
          {pending ? 'Loading…' : 'Run'}
        </button>
        <OutputPanel panel={panel} />
      </div>
    </section>
  )
}

interface FormField {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}

interface FormPanelProps<T> extends ActionPanelProps<T> {
  actionLabel: string
  fields: FormField[]
}

function FormPanel<T>({
  title,
  description,
  tone,
  pending,
  panel,
  actionLabel,
  fields,
  onRun,
}: FormPanelProps<T>): JSX.Element {
  return (
    <section className="rounded-[1.75rem] border border-white/80 bg-white/85 p-6 shadow-card">
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
              <span className="mb-2 block text-sm font-medium text-ink/80">{field.label}</span>
              <input
                value={field.value}
                onChange={(event) => field.onChange(event.target.value)}
                placeholder={field.placeholder}
                className="w-full rounded-2xl border border-ink/15 bg-cream px-4 py-3 font-mono text-sm outline-none transition focus:border-pine focus:ring-2 focus:ring-pine/15"
              />
            </label>
          ))}
        </div>
        <button
          type="submit"
          className="inline-flex w-fit rounded-full bg-ink px-5 py-3 text-sm font-semibold text-white transition hover:bg-pine"
        >
          {pending ? 'Working…' : actionLabel}
        </button>
        <OutputPanel panel={panel} />
      </form>
    </section>
  )
}

interface PanelHeaderProps {
  title: string
  description: string
  tone: 'pine' | 'ocean' | 'ember'
}

function PanelHeader({ title, description, tone }: PanelHeaderProps): JSX.Element {
  const badgeClass = {
    pine: 'border-pine/20 bg-pine/10 text-pine',
    ocean: 'border-ocean/20 bg-ocean/10 text-ocean',
    ember: 'border-ember/20 bg-ember/10 text-ember',
  }[tone]

  return (
    <div className="space-y-3">
      <div className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${badgeClass}`}>
        {title}
      </div>
      <div>
        <h2 className="font-display text-2xl font-semibold text-ink">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-ink/70">{description}</p>
      </div>
    </div>
  )
}

interface OutputPanelProps<T> {
  panel: PanelState<T>
}

function OutputPanel<T>({ panel }: OutputPanelProps<T>): JSX.Element {
  if (panel.status === 'idle') {
    return (
      <div className="rounded-[1.5rem] border border-dashed border-ink/15 bg-cream/60 px-4 py-5 text-sm text-ink/55">
        Run this action to see a real response from the channel-doctor core.
      </div>
    )
  }

  if (panel.status === 'loading') {
    return (
      <div className="rounded-[1.5rem] border border-pine/15 bg-pine/5 px-4 py-5 text-sm text-ink/70">
        Working on it…
      </div>
    )
  }

  if (panel.status === 'error') {
    return (
      <div className="rounded-[1.5rem] border border-ember/20 bg-ember/10 px-4 py-5 text-sm leading-6 text-ink/80">
        <div className="font-semibold text-ink">Request failed</div>
        <div className="mt-2 font-mono text-xs whitespace-pre-wrap">{panel.message}</div>
      </div>
    )
  }

  return (
    <pre className="overflow-x-auto rounded-[1.5rem] border border-ink/10 bg-[#13201f] px-4 py-5 font-mono text-xs leading-6 text-[#e8f4f0]">
      {JSON.stringify(panel.data, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2)}
    </pre>
  )
}

function ChecklistItem({ title }: { title: string }): JSX.Element {
  return (
    <div className="rounded-2xl border border-ink/10 bg-cream px-4 py-3 text-sm font-medium text-ink/80">
      {title}
    </div>
  )
}

export default App
