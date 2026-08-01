import { DominoData } from './domino'

const STORAGE_KEY = '3d-dominoes-save-v2'

// --- LocalStorage Save/Load(自动保存)---

export function saveToLocal(data: DominoData[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}

export function loadFromLocal(): DominoData[] | null {
  try {
    const json = localStorage.getItem(STORAGE_KEY)
    if (!json) return null
    const data = JSON.parse(json) as DominoData[]
    return sanitizeData(data)
  } catch {
    return null
  }
}

/** 校验并清洗导入的骨牌数据,非法项过滤 */
export function sanitizeData(data: unknown): DominoData[] | null {
  if (!Array.isArray(data)) return null
  const out: DominoData[] = []
  for (const raw of data) {
    if (!raw || typeof raw !== 'object') continue
    const d = raw as Record<string, unknown>
    if (!Number.isInteger(d.id) || !Number.isFinite(d.x) || !Number.isFinite(d.z)
      || !Number.isFinite(d.rotation) || !Number.isFinite(d.color)) {
      continue
    }
    out.push({
      id: d.id as number,
      x: d.x as number,
      z: d.z as number,
      rotation: d.rotation as number,
      color: d.color as number,
      w: Number.isFinite(d.w) ? d.w as number : undefined,
      h: Number.isFinite(d.h) ? d.h as number : undefined,
      d: Number.isFinite(d.d) ? d.d as number : undefined,
    })
  }
  return out
}

// --- File Export/Import ---

export function exportToFile(data: DominoData[], filename = 'dominoes.json'): void {
  const json = JSON.stringify(data, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  // 延迟回收,避免 Safari 在下载完成前撤销 URL
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function importFromFile(): Promise<DominoData[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      try {
        const text = await file.text()
        const data = sanitizeData(JSON.parse(text))
        resolve(data)
      } catch {
        resolve(null)
      }
    }
    input.click()
  })
}
