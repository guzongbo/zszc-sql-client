export type HostBootstrap = {
  plugin_id: string
  plugin_name: string
  plugin_version: string
  current_platform: string
  permissions: string[]
}

type PluginHostBootstrapMessage = {
  channel: 'zszc_plugin_host'
  kind: 'bootstrap'
  payload: HostBootstrap
}

type PluginHostRpcResponseMessage = {
  channel: 'zszc_plugin_host'
  kind: 'rpc_response'
  request_id: string
  ok: boolean
  result?: unknown
  error_message?: string
}

type PluginHostMessage = PluginHostBootstrapMessage | PluginHostRpcResponseMessage

const pendingRequests = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (reason?: unknown) => void }
>()

let requestSeed = 0
let bootstrapPayload: HostBootstrap | null = null
const bootstrapWaiters = new Set<(payload: HostBootstrap) => void>()

window.addEventListener('message', (event: MessageEvent<PluginHostMessage>) => {
  const payload = event.data
  if (!payload || payload.channel !== 'zszc_plugin_host') {
    return
  }

  if (payload.kind === 'bootstrap') {
    bootstrapPayload = payload.payload
    for (const listener of bootstrapWaiters) {
      listener(payload.payload)
    }
    bootstrapWaiters.clear()
    return
  }

  if (payload.kind === 'rpc_response') {
    const pending = pendingRequests.get(payload.request_id)
    if (!pending) {
      return
    }

    pendingRequests.delete(payload.request_id)
    if (payload.ok) {
      pending.resolve(payload.result ?? null)
    } else {
      pending.reject(new Error(payload.error_message || '插件调用失败'))
    }
  }
})

window.parent.postMessage(
  {
    channel: 'zszc_plugin_host',
    kind: 'plugin_ready',
  },
  '*',
)

export function getHostBootstrap() {
  if (bootstrapPayload) {
    return Promise.resolve(bootstrapPayload)
  }

  return new Promise<HostBootstrap>((resolve) => {
    bootstrapWaiters.add(resolve)
  })
}

export function invokeHostMethod<T>(method: string, params: unknown) {
  const requestId = `${Date.now()}-${requestSeed++}`

  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(requestId, {
      resolve: (value) => resolve(value as T),
      reject,
    })

    window.parent.postMessage(
      {
        channel: 'zszc_plugin_host',
        kind: 'rpc_request',
        request_id: requestId,
        method,
        params,
      },
      '*',
    )
  })
}
