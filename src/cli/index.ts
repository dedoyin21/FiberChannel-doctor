#!/usr/bin/env node
import { createRequire } from 'node:module'
import type { Command as CommanderCommand } from 'commander'
import { CKB_ASSET, formatAmount } from '../resolver/index.js'
import { checkOpen } from '../pre-open/index.js'
import { openAndWait, listNormalized, type NormalizedChannel } from '../lifecycle/index.js'
import { diagnose, canPay, translateError } from '../diagnostics/index.js'
import { checkClose, closeChannel } from '../pre-close/index.js'
import { connectPeer } from '../network/index.js'
import { trackPayment } from '../payments/index.js'

const require = createRequire(import.meta.url)
const { Command, Option } = require('commander') as typeof import('commander')

const CKB_PER_SHANNON = 100_000_000n
const DEFAULT_RPC_URL = 'http://127.0.0.1:8227'
const TESTNET_RPC_URL = 'http://18.162.235.225:8227'

function shannonFromCKB(ckb: string): bigint {
  const [whole, frac = ''] = ckb.split('.')
  return BigInt(whole) * CKB_PER_SHANNON + BigInt(frac.padEnd(8, '0').slice(0, 8))
}

function log(msg = ''): void {
  process.stdout.write(`${msg}\n`)
}

function emitJson(value: unknown, stream: NodeJS.WriteStream = process.stdout): void {
  stream.write(`${JSON.stringify(value, (_key, current) => typeof current === 'bigint' ? current.toString() : current, 2)}\n`)
}

function fail(msg: string, options: { json?: boolean; code?: string; details?: unknown } = {}): never {
  if (options.json) {
    emitJson({
      ok: false,
      error: msg,
      ...(options.code ? { code: options.code } : {}),
      ...(options.details !== undefined ? { details: options.details } : {}),
    }, process.stderr)
    process.exit(1)
  }

  process.stderr.write(`\nERROR: ${msg}\n\n`)
  process.exit(1)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function hasCliOption(flag: string): boolean {
  return process.argv.includes(flag) || process.argv.some((arg) => arg.startsWith(`${flag}=`))
}

function resolveConfig(cmd: CommanderCommand): { url: string; authToken?: string } {
  const opts = cmd.optsWithGlobals() as { rpcUrl: string; testnet?: boolean; authToken?: string }
  const url = hasCliOption('--rpc-url') ? opts.rpcUrl : opts.testnet ? TESTNET_RPC_URL : opts.rpcUrl
  const authToken = opts.authToken?.trim()
  return authToken ? { url, authToken } : { url }
}

function shouldUseJson(cmd: CommanderCommand): boolean {
  const opts = cmd.optsWithGlobals() as { json?: boolean }
  return Boolean(opts.json)
}

function renderProgressLine(line: string, lastLength: { value: number }): void {
  if (!process.stdout.isTTY) {
    log(line)
    return
  }
  const padded = line.padEnd(lastLength.value, ' ')
  process.stdout.write(`\r${padded}`)
  lastLength.value = Math.max(lastLength.value, line.length)
}

function renderWatchFrame(channel: NormalizedChannel, elapsedMs: number): void {
  if (process.stdout.isTTY) process.stdout.write('\x1Bc')
  else log('')

  const lines = [
    `Watching channel ${channel.channelId}`,
    '',
    `State:                ${channel.stateName}${channel.enabled ? '' : ' (DISABLED)'}`,
    `Local balance:        ${channel.localBalanceFmt}`,
    `Remote balance:       ${channel.remoteBalanceFmt}`,
    `Usable capacity:      ${channel.usableCapacityFmt}`,
    `Offered TLC balance:  ${channel.offeredTlcBalance} shannon`,
    `Received TLC balance: ${channel.receivedTlcBalance} shannon`,
    `Elapsed:              ${Math.floor(elapsedMs / 1000)}s`,
  ]

  process.stdout.write(`${lines.join('\n')}\n`)
}

const program = new Command()
program
  .name('channel-doctor')
  .description('Channel lifecycle guardrails and diagnostics for Fiber Network')
  .version('0.1.0')
  .addOption(new Option('--rpc-url <url>', 'Fiber node RPC URL').default(DEFAULT_RPC_URL).env('FIBER_RPC_URL'))
  .addOption(new Option('--auth-token <token>', 'Bearer token for authenticated Fiber RPC endpoints').env('FIBER_RPC_AUTH_TOKEN'))
  .addOption(new Option('--json', 'Print machine-readable JSON output'))
  .addOption(new Option('--testnet', 'Use the public Fiber testnet RPC node'))

program.command('status').description('List all channels with decoded balances').action(async (_: unknown, cmd: CommanderCommand) => {
  const config = resolveConfig(cmd)
  const json = shouldUseJson(cmd)
  try {
    const channels = await listNormalized(config)
    if (json) {
      emitJson({ ok: true, count: channels.length, channels })
      return
    }
    if (!channels.length) {
      log('No channels found.')
      return
    }

    log(`\n${'-'.repeat(60)}\nFound ${channels.length} channel(s)\n`)
    for (const ch of channels) {
      log(`Channel: ${ch.channelId.slice(0, 16)}...`)
      log(`  Peer:    ${ch.peerId.slice(0, 20)}...`)
      log(`  State:   ${ch.stateName}${ch.enabled ? '' : ' (DISABLED)'}`)
      log(`  Asset:   ${ch.asset}`)
      log(`  Local:   ${ch.localBalanceFmt}`)
      log(`  Remote:  ${ch.remoteBalanceFmt}`)
      log(`  Usable:  ${ch.usableCapacityFmt}${ch.canSend ? ' [ok]' : ' [zero]'}`)
      if (ch.offeredTlcBalance > 0n) log(`  TLC out: ${ch.offeredTlcBalance} shannon in-flight`)
      if (ch.receivedTlcBalance > 0n) log(`  TLC in:  ${ch.receivedTlcBalance} shannon in-flight`)
      log(`  Created: ${ch.createdAt.toISOString()}`)
      log('-'.repeat(60))
    }
  } catch (e) {
    fail((e as Error).message, { json, code: 'status_failed' })
  }
})

program.command('check-open <peerId> <amountCKB>').description('Validate before opening a channel').action(async (peerId: string, amountCKB: string, _: unknown, cmd: CommanderCommand) => {
  const config = resolveConfig(cmd)
  const json = shouldUseJson(cmd)
  try {
    const { ok, checks } = await checkOpen({ config, peerId, fundingAmountShannon: shannonFromCKB(amountCKB) })
    if (json) {
      emitJson({ ok, peerId, amountCKB, checks })
      if (!ok) process.exit(1)
      return
    }
    log(`\nPre-open checks for ${amountCKB} CKB -> ${peerId.slice(0, 16)}...\n`)
    for (const c of checks) log(`  ${c.passed ? '[ok]' : '[x]'} ${c.message}`)
    log('')
    if (ok) {
      log('Safe to open.')
      log(`Run: channel-doctor open ${peerId} ${amountCKB}`)
      return
    }
    log('Fix issues above before opening.')
    process.exit(1)
  } catch (e) {
    fail((e as Error).message, { json, code: 'check_open_failed', details: { peerId, amountCKB } })
  }
})

program.command('open <peerId> <amountCKB>').description('Open a channel and wait for CHANNEL_READY')
  .option('--private', 'Open a private channel')
  .action(async (peerId: string, amountCKB: string, options: { private?: boolean }, cmd: CommanderCommand) => {
    const config = resolveConfig(cmd)
    const json = shouldUseJson(cmd)
    try {
      if (!json) log(`\nOpening channel: ${amountCKB} CKB -> ${peerId.slice(0, 16)}...\n`)
      const result = await openAndWait({
        config,
        peerId,
        fundingAmountShannon: shannonFromCKB(amountCKB),
        isPublic: !options.private,
        onProgress: json ? undefined : (msg) => log(`  -> ${msg}`),
      })
      if (json) {
        emitJson({ ok: true, peerId, amountCKB, isPublic: !options.private, ...result })
        return
      }
      log(`\nChannel ready\n  ID:     ${result.channelId}\n  Local:  ${result.channel.localBalanceFmt}\n  Usable: ${result.channel.usableCapacityFmt}`)
    } catch (e) {
      fail((e as Error).message, { json, code: 'open_failed', details: { peerId, amountCKB, isPublic: !options.private } })
    }
  })

program.command('diagnose <channelId>').description('Diagnose a channel').action(async (channelId: string, _: unknown, cmd: CommanderCommand) => {
  const config = resolveConfig(cmd)
  const json = shouldUseJson(cmd)
  try {
    if (json) {
      emitJson({ ok: true, diagnosis: await diagnose(config, channelId) })
      return
    }
    log(`\nDiagnosing ${channelId.slice(0, 16)}...\n`)
    const d = await diagnose(config, channelId)
    log(`  State:  ${d.channel.stateName}\n  Asset:  ${d.channel.asset}\n  Local:  ${d.channel.localBalanceFmt}\n  Usable: ${d.channel.usableCapacityFmt}\n  Code:   ${d.code}\n`)
    log(`  ${d.healthy ? '[ok]' : '[warn]'} ${d.plain}`)
    if (d.suggestion) log(`  Tip: ${d.suggestion}`)
    log('')
  } catch (e) {
    fail((e as Error).message, { json, code: 'diagnose_failed', details: { channelId } })
  }
})

program.command('connect <multiaddr>').description('Connect to a Fiber peer by multiaddr').action(async (multiaddr: string, _: unknown, cmd: CommanderCommand) => {
  const config = resolveConfig(cmd)
  const json = shouldUseJson(cmd)
  try {
    const result = await connectPeer(config, multiaddr)
    if (json) {
      emitJson({ ok: true, ...result })
      return
    }
    log(`\nConnected to peer ${result.peerId}`)
    log(`Confirmed in peer list: ${result.peer.connected_addr ?? multiaddr}\n`)
  } catch (e) {
    const translated = translateError(e as Error)
    fail([translated.plain, translated.suggestion].filter(Boolean).join('\n'), { json, code: 'connect_failed', details: { multiaddr } })
  }
})

program.command('track-payment <paymentHash>').description('Poll payment status until it succeeds or fails').action(async (paymentHash: string, _: unknown, cmd: CommanderCommand) => {
  const config = resolveConfig(cmd)
  const json = shouldUseJson(cmd)
  const lastLength = { value: 0 }
  try {
    const result = await trackPayment(config, paymentHash, ({ status, elapsedMs }) => {
      if (json) return
      renderProgressLine(`  -> Status: ${status} (${Math.floor(elapsedMs / 1000)}s elapsed...)`, lastLength)
    })
    if (!json && process.stdout.isTTY) process.stdout.write('\n')

    if (json) {
      emitJson({ ok: result.status === 'Succeeded', ...result })
      if (result.status !== 'Succeeded') process.exit(1)
      return
    }

    if (result.status === 'Succeeded') {
      log('\nPayment succeeded.')
      log(`Fee paid: ${formatAmount(result.fee, CKB_ASSET)}\n`)
      return
    }

    const translated = translateError(result.failedError ?? 'Payment failed')
    log('\nPayment failed.')
    log(translated.plain)
    if (translated.suggestion) log(`Tip: ${translated.suggestion}`)
    log('')
    process.exit(1)
  } catch (e) {
    if (!json && process.stdout.isTTY) process.stdout.write('\n')
    fail((e as Error).message, { json, code: 'track_payment_failed', details: { paymentHash } })
  }
})

program.command('check-close <channelId>').description('Check if safe to close').action(async (channelId: string, _: unknown, cmd: CommanderCommand) => {
  const config = resolveConfig(cmd)
  const json = shouldUseJson(cmd)
  try {
    const { safe, checks } = await checkClose(config, channelId)
    if (json) {
      emitJson({ ok: safe, channelId, safe, checks })
      if (!safe) process.exit(1)
      return
    }
    log(`\nPre-close checks for ${channelId.slice(0, 16)}...\n`)
    for (const c of checks) log(`  ${c.passed ? '[ok]' : '[warn]'} ${c.message}`)
    log('')
    if (safe) {
      log('Safe to close.')
      log(`Run: channel-doctor close ${channelId}`)
      return
    }
    log('Not safe to close yet.')
    process.exit(1)
  } catch (e) {
    fail((e as Error).message, { json, code: 'check_close_failed', details: { channelId } })
  }
})

program.command('close <channelId>').description('Close a channel').option('--force', 'Force-close').action(async (channelId: string, options: { force?: boolean }, cmd: CommanderCommand) => {
  const config = resolveConfig(cmd)
  const json = shouldUseJson(cmd)
  try {
    if (!json) log(`\nClosing ${channelId.slice(0, 16)}...\n`)
    await closeChannel(config, channelId, { force: options.force, onProgress: json ? undefined : (msg) => log(`  -> ${msg}`) })
    if (json) emitJson({ ok: true, channelId, force: Boolean(options.force) })
  } catch (e) {
    fail((e as Error).message, { json, code: 'close_failed', details: { channelId, force: Boolean(options.force) } })
  }
})

program.command('can-pay <amountCKB>').description('Check local outgoing capacity for a payment amount').action(async (amountCKB: string, _: unknown, cmd: CommanderCommand) => {
  const config = resolveConfig(cmd)
  const json = shouldUseJson(cmd)
  try {
    const result = await canPay(config, shannonFromCKB(amountCKB))
    if (json) {
      emitJson({ ok: result.canPay, amountCKB, ...result })
      if (!result.canPay) process.exit(1)
      return
    }
    log(`\nChecking readiness for ${amountCKB} CKB...\n`)
    log(`  Total usable: ${result.usableCapacityFmt}`)
    log(`  Largest channel: ${result.maxChannelCapacityFmt}`)
    log(`  ${result.canPay ? '[ok]' : '[x]'} ${result.reason}`)
    if (result.suggestion) log(`  Tip: ${result.suggestion}`)
    log('')
    if (!result.canPay) process.exit(1)
  } catch (e) {
    fail((e as Error).message, { json, code: 'can_pay_failed', details: { amountCKB } })
  }
})

program.command('watch <channelId>').description('Watch a channel until it closes or fails').action(async (channelId: string, _: unknown, cmd: CommanderCommand) => {
  const config = resolveConfig(cmd)
  const json = shouldUseJson(cmd)
  const startedAt = Date.now()
  let interrupted = false
  const onSigint = () => { interrupted = true }

  process.on('SIGINT', onSigint)
  try {
    while (!interrupted) {
      const channels = await listNormalized(config)
      const channel = channels.find((item) => item.channelId === channelId)
      if (!channel) throw new Error(`Channel ${channelId.slice(0, 14)}... not found.`)
      const elapsedMs = Date.now() - startedAt
      if (json) emitJson({ event: 'snapshot', elapsedMs, channel })
      else renderWatchFrame(channel, elapsedMs)
      if (channel.stateName === 'CLOSED' || channel.stateName === 'FAILED') {
        if (json) emitJson({ event: 'stopped', reason: 'terminal_state', state: channel.stateName, channelId })
        else log(`\nWatch stopped: channel entered ${channel.stateName}.`)
        return
      }
      await sleep(3_000)
    }
    if (json) emitJson({ event: 'stopped', reason: 'interrupted', channelId })
    else log('\nWatch stopped.')
  } catch (e) {
    fail((e as Error).message, { json, code: 'watch_failed', details: { channelId } })
  } finally {
    process.off('SIGINT', onSigint)
  }
})

program.parseAsync(process.argv).catch((e: unknown) => fail((e as Error).message))
