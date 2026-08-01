/** 多米诺骨牌全局配置 — 运行时调整 */

export type SizeKey = 'small' | 'medium' | 'large'
export type GapKey = 'tight' | 'standard' | 'loose'

export const config = {
  // —— 常用 ——
  sizeKey: 'medium' as SizeKey,   // 骨牌尺寸预设(对新放置的骨牌生效)
  gapKey: 'standard' as GapKey,   // 摆放间距预设
  snap: true,                     // 网格对齐
  snapStep: 0.25,                 // 对齐步长
  sound: true,                    // 音效开关

  // —— 物理(高级)——
  mass: 0.5,
  friction: 0.45,
  restitution: 0.3,
  angularDamping: 0.15,
  impulseStrength: 0.45,

  // —— 颜色 ——
  selectedColorIdx: 0,
}

/** 骨牌尺寸预设:宽 × 高 × 厚(比例约 2 : 1 : 0.3) */
export const SIZE_PRESETS: Record<SizeKey, { w: number; h: number; d: number; label: string }> = {
  small:  { w: 0.55, h: 1.10, d: 0.17, label: '小巧' },
  medium: { w: 0.80, h: 1.60, d: 0.24, label: '标准' },
  large:  { w: 1.10, h: 2.20, d: 0.33, label: '大型' },
}

/** 间距预设(骨牌之间的空隙) */
export const GAP_PRESETS: Record<GapKey, { gap: number; label: string }> = {
  tight:    { gap: 0.03, label: '紧密' },
  standard: { gap: 0.08, label: '标准' },
  loose:    { gap: 0.16, label: '宽松' },
}

/** 当前尺寸 */
export function dominoSize() {
  return SIZE_PRESETS[config.sizeKey]
}

/** 当前间距(空隙) */
export function dominoGap(): number {
  return GAP_PRESETS[config.gapKey].gap
}

/** 摆放步长 = 骨牌宽度 + 空隙 */
export function dominoSpacing(): number {
  return dominoSize().w + dominoGap()
}

/** 马卡龙配色 */
export const COLOR_PRESETS: { value: number; name: string; css: string }[] = [
  { value: 0xf472b6, name: '樱粉', css: '#f472b6' },
  { value: 0xfb923c, name: '蜜橙', css: '#fb923c' },
  { value: 0xfacc15, name: '柠檬', css: '#facc15' },
  { value: 0x4ade80, name: '薄荷', css: '#4ade80' },
  { value: 0x38bdf8, name: '天蓝', css: '#38bdf8' },
  { value: 0xa78bfa, name: '薰衣草', css: '#a78bfa' },
  { value: 0xfef3c7, name: '奶油', css: '#fef3c7' },
]

export function getSelectedColor(): number {
  return COLOR_PRESETS[config.selectedColorIdx].value
}
