import { DominoData, generateId, dominoW } from './domino'
import { COLOR_PRESETS, dominoGap } from './config'

export interface TemplateDef {
  name: string
  icon: string
  generate: () => DominoData[]
}

// ======== 辅助 ========

interface PathPoint { x: number; z: number }

function nextId(): number {
  return generateId()
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/**
 * 沿折线路径放置骨牌。
 * 每块骨牌的"前方"(局部 +z)指向路径前进方向 → 推倒后可沿路径连锁。
 */
function placeAlongPath(
  points: PathPoint[],
  spacing: number,
  colorFn: (i: number) => number,
  out: DominoData[],
) {
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.hypot(dx, dz)
    if (len < 1e-6) continue
    const n = Math.max(1, Math.round(len / spacing))
    const rotation = Math.atan2(dx, dz)
    for (let j = 0; j < n; j++) {
      const t = j / n
      out.push({
        id: nextId(),
        x: round2(a.x + dx * t),
        z: round2(a.z + dz * t),
        rotation,
        color: colorFn(out.length),
      })
    }
  }
}

function colorArray(): number[] {
  return COLOR_PRESETS.map(c => c.value)
}

function rainbow(i: number): number {
  const colors = colorArray()
  return colors[i % colors.length]
}

function spacing(): number {
  return dominoW() + dominoGap()
}

// ======== 螺旋 ========
function generateSpiral(): DominoData[] {
  const out: DominoData[] = []
  const pts: PathPoint[] = []
  const total = 100
  const turns = 4
  for (let i = 0; i <= total; i++) {
    const t = (i / total) * turns * Math.PI * 2
    const radius = 0.3 + (i / total) * 3.6
    pts.push({ x: Math.cos(t) * radius, z: Math.sin(t) * radius })
  }
  placeAlongPath(pts, spacing(), rainbow, out)
  return out
}

// ======== 蛇形(S 型折线,连续路径)======
function generateSnake(): DominoData[] {
  const out: DominoData[] = []
  const s = spacing()
  const cols = 6
  const rows = 4
  const pts: PathPoint[] = []
  const startX = -((cols - 1) / 2) * s
  for (let row = 0; row < rows; row++) {
    const z = row * s * 1.2
    if (row % 2 === 0) {
      for (let c = 0; c < cols; c++) pts.push({ x: startX + c * s, z })
    } else {
      for (let c = cols - 1; c >= 0; c--) pts.push({ x: startX + c * s, z })
    }
  }
  placeAlongPath(pts, s, rainbow, out)
  return out
}

// ======== 三角墙(金字塔)======
function generatePyramid(): DominoData[] {
  const out: DominoData[] = []
  const s = spacing()
  const rows = 10
  for (let row = 0; row < rows; row++) {
    const count = rows - row
    const z = row * s * 0.65
    for (let i = 0; i < count; i++) {
      const x = (i - (count - 1) / 2) * s
      out.push({
        id: nextId(),
        x: round2(x),
        z: round2(z),
        rotation: Math.PI / 2, // 前方朝 +x,行内从左到右连锁
        color: rainbow(out.length),
      })
    }
  }
  return out
}

// ======== 心形 ========
function generateHeart(): DominoData[] {
  const out: DominoData[] = []
  const pts: PathPoint[] = []
  const total = 120
  const scale = 0.22
  for (let i = 0; i <= total; i++) {
    const t = (i / total) * Math.PI * 2
    const sinT = Math.sin(t)
    const x = 16 * sinT * sinT * sinT * scale
    const z = (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * scale
    pts.push({ x, z })
  }
  placeAlongPath(pts, spacing(), rainbow, out)
  return out
}

// ======== 同心圆 ========
function generateCircles(): DominoData[] {
  const out: DominoData[] = []
  const s = spacing()
  const rings = 4
  for (let ring = 1; ring <= rings; ring++) {
    const radius = ring * s * 1.25
    const circumference = 2 * Math.PI * radius
    const count = Math.max(10, Math.floor(circumference / s))
    const pts: PathPoint[] = []
    for (let i = 0; i <= count; i++) {
      const angle = (i / count) * Math.PI * 2
      pts.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius })
    }
    placeAlongPath(pts, s, rainbow, out)
  }
  return out
}

// ======== 回字(方形螺旋,连续路径)======
function generateSquare(): DominoData[] {
  const out: DominoData[] = []
  const s = spacing()
  const pts: PathPoint[] = []
  const loops = 4
  let x = 0
  let z = 0
  const dirs = [
    { x: 0, z: -1 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 },
  ]
  let d = 0
  let len = 2
  for (let l = 0; l < loops; l++) {
    for (let e = 0; e < 4; e++) {
      const dir = dirs[d]
      for (let i = 0; i < len; i++) {
        x += dir.x * s
        z += dir.z * s
        pts.push({ x, z })
      }
      d = (d + 1) % 4
      if (e % 2 === 1) len += 2
    }
  }
  placeAlongPath(pts, s, rainbow, out)
  return out
}

// ======== 交叉(X 形)======
function generateCross(): DominoData[] {
  const out: DominoData[] = []
  const s = spacing()
  const arm = 7
  // 主对角线
  const diag1: PathPoint[] = []
  for (let i = -arm; i <= arm; i++) diag1.push({ x: i * s, z: i * s })
  placeAlongPath(diag1, s, rainbow, out)
  // 副对角线
  const diag2: PathPoint[] = []
  for (let i = -arm; i <= arm; i++) diag2.push({ x: i * s, z: -i * s })
  placeAlongPath(diag2, s, rainbow, out)
  return out
}

// ======== 模板注册 ========
export const TEMPLATES: TemplateDef[] = [
  { name: '螺旋', icon: '🌀', generate: generateSpiral },
  { name: '蛇形', icon: '🐍', generate: generateSnake },
  { name: '三角墙', icon: '🔺', generate: generatePyramid },
  { name: '心形', icon: '❤️', generate: generateHeart },
  { name: '同心圆', icon: '⭕', generate: generateCircles },
  { name: '回字', icon: '◻️', generate: generateSquare },
  { name: '交叉', icon: '✖️', generate: generateCross },
]
