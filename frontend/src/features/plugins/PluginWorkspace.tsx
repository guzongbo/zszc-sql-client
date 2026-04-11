import { useEffect, useRef, useState } from 'react'
import { invokePluginBackend, readPluginFrontendEntry } from '../../api'
import type { InstalledPlugin } from '../../types'

type PluginWorkspaceProps = {
  plugin: InstalledPlugin
}

type PluginHostEvent =
  | {
      channel: 'zszc_plugin_host'
      kind: 'plugin_ready'
    }
  | {
      channel: 'zszc_plugin_host'
      kind: 'rpc_request'
      request_id: string
      method: string
      params?: unknown
    }

type PluginHostResponse = {
  channel: 'zszc_plugin_host'
  kind: 'bootstrap' | 'rpc_response'
  request_id?: string
  ok?: boolean
  result?: unknown
  error_message?: string
  payload?: unknown
}

export function PluginWorkspace({ plugin }: PluginWorkspaceProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const [iframeSrcDoc, setIframeSrcDoc] = useState('')
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    let cancelled = false

    void Promise.all([
      import('@tauri-apps/api/core'),
      readPluginFrontendEntry(plugin.id),
    ])
      .then(([{ convertFileSrc }, document]) => {
        const htmlUrl = convertFileSrc(plugin.frontend_entry_path)
        const baseHref = htmlUrl.slice(0, htmlUrl.lastIndexOf('/') + 1)
        const html = injectBaseHref(document.html, baseHref)

        if (cancelled) {
          return
        }
        setIframeSrcDoc(html)
        setLoadError('')
      })
      .catch((error) => {
        if (cancelled) {
          return
        }
        setIframeSrcDoc('')
        setLoadError(error instanceof Error ? error.message : '无法加载插件前端页面')
      })

    return () => {
      cancelled = true
    }
  }, [plugin.frontend_entry_path, plugin.id])

  useEffect(() => {
    const handleMessage = (event: MessageEvent<PluginHostEvent>) => {
      if (event.source !== iframeRef.current?.contentWindow) {
        return
      }

      const payload = event.data
      if (!payload || payload.channel !== 'zszc_plugin_host') {
        return
      }

      if (payload.kind === 'plugin_ready') {
        postMessageToPlugin(iframeRef.current, {
          channel: 'zszc_plugin_host',
          kind: 'bootstrap',
          payload: {
            plugin_id: plugin.id,
            plugin_name: plugin.name,
            plugin_version: plugin.version,
            current_platform: plugin.current_platform,
            permissions: plugin.permissions,
          },
        })
        return
      }

      if (payload.kind === 'rpc_request') {
        void invokePluginBackend<unknown>(
          plugin.id,
          payload.method,
          payload.params ?? null,
        )
          .then((result) => {
            postMessageToPlugin(iframeRef.current, {
              channel: 'zszc_plugin_host',
              kind: 'rpc_response',
              request_id: payload.request_id,
              ok: true,
              result,
            })
          })
          .catch((error) => {
            postMessageToPlugin(iframeRef.current, {
              channel: 'zszc_plugin_host',
              kind: 'rpc_response',
              request_id: payload.request_id,
              ok: false,
              error_message:
                error instanceof Error ? error.message : '插件后端调用失败',
            })
          })
      }
    }

    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
    }
  }, [plugin.current_platform, plugin.id, plugin.name, plugin.permissions, plugin.version])

  if (loadError) {
    return (
      <div className="plugin-workspace-error">
        <strong>插件加载失败</strong>
        <p>{loadError}</p>
      </div>
    )
  }

  if (!iframeSrcDoc) {
    return (
      <div className="plugin-workspace-loading">
        <strong>插件工作区准备中</strong>
        <p>正在解析前端入口并挂载插件页面。</p>
      </div>
    )
  }

  return (
    <div className="plugin-workspace-shell">
      <iframe
        key={`${plugin.id}:${plugin.version}`}
        ref={iframeRef}
        className="plugin-workspace-frame"
        srcDoc={iframeSrcDoc}
        title={plugin.name}
      />
    </div>
  )
}

function postMessageToPlugin(
  iframe: HTMLIFrameElement | null,
  payload: PluginHostResponse,
) {
  iframe?.contentWindow?.postMessage(payload, '*')
}

function injectBaseHref(html: string, baseHref: string) {
  if (html.includes('<head>')) {
    return html.replace('<head>', `<head><base href="${baseHref}">`)
  }

  return `<base href="${baseHref}">${html}`
}
