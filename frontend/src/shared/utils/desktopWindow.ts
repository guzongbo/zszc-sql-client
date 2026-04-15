const windowDragIgnoreSelector = [
  'button',
  'input',
  'textarea',
  'select',
  'option',
  'a',
  '[role="button"]',
  '[role="menu"]',
  '[role="menuitem"]',
  '[contenteditable="true"]',
  '[data-window-drag-ignore="true"]',
].join(', ')

let startDesktopWindowDraggingTask: Promise<(() => Promise<void>) | null> | null = null
let toggleDesktopWindowMaximizeTask: Promise<(() => Promise<void>) | null> | null = null

export async function startDesktopWindowDragging() {
  if (startDesktopWindowDraggingTask == null) {
    startDesktopWindowDraggingTask = Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/window'),
    ]).then(([coreModule, windowModule]) => {
      if (!coreModule.isTauri()) {
        return null
      }

      return () => windowModule.getCurrentWindow().startDragging()
    })
  }

  await (await startDesktopWindowDraggingTask)?.()
}

export async function toggleDesktopWindowMaximize() {
  if (toggleDesktopWindowMaximizeTask == null) {
    toggleDesktopWindowMaximizeTask = Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/window'),
    ]).then(([coreModule, windowModule]) => {
      if (!coreModule.isTauri()) {
        return null
      }

      return () => windowModule.getCurrentWindow().toggleMaximize()
    })
  }

  await (await toggleDesktopWindowMaximizeTask)?.()
}

export function shouldIgnoreWindowDragTarget(target: HTMLElement) {
  return target.closest(windowDragIgnoreSelector) != null
}
