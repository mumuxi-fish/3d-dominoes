/**
 * Web Audio API 音效 — 全部程序化合成,无音频文件。
 * 碰撞音带节流,避免推倒时上百个声音同时触发。
 */
import { config } from './config'

let ctx: AudioContext | null = null
let lastImpactAt = 0

function getContext(): AudioContext {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as any).webkitAudioContext
    if (!AC) return null as unknown as AudioContext
    ctx = new AC()
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

/** 用户交互时恢复音频上下文(浏览器自动播放策略) */
export function unlockAudio() {
  const ac = getContext()
  if (ac && ac.state === 'suspended') ac.resume()
}

/**
 * 撞击声(木制嗒嗒声),0-1 强度
 */
export function playImpact(strength: number = 0.5) {
  if (!config.sound) return
  // 节流:同一时刻只允许一个撞击声
  const now = performance.now()
  if (now - lastImpactAt < 25) return
  lastImpactAt = now

  try {
    const ac = getContext()
    if (!ac) return
    const s = Math.max(0, Math.min(1, strength))

    const master = ac.createGain()
    master.gain.value = 0.12 * (0.25 + 0.75 * s)
    master.connect(ac.destination)

    // 噪声层:木质震动
    const bufLen = Math.floor(ac.sampleRate * 0.07)
    const buf = ac.createBuffer(1, bufLen, ac.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < bufLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-(i / ac.sampleRate) * 55)
    }
    const noise = ac.createBufferSource()
    noise.buffer = buf
    const bp = ac.createBiquadFilter()
    bp.type = 'bandpass'
    bp.frequency.value = 700 + 500 * s
    bp.Q.value = 1.4
    const ng = ac.createGain()
    ng.gain.setValueAtTime(1, ac.currentTime)
    ng.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.05)
    noise.connect(bp)
    bp.connect(ng)
    ng.connect(master)
    noise.start()

    // 低频层:厚实撞击
    const osc = ac.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(130 + 70 * s, ac.currentTime)
    osc.frequency.exponentialRampToValueAtTime(45, ac.currentTime + 0.05)
    const og = ac.createGain()
    og.gain.setValueAtTime(0.55, ac.currentTime)
    og.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.07)
    osc.connect(og)
    og.connect(master)
    osc.start()
    osc.stop(ac.currentTime + 0.08)
    noise.stop(ac.currentTime + 0.09)
  } catch {
    /* 音效失败不影响主功能 */
  }
}

/** 放置提示音(轻快的 "嗒") */
export function playPlace() {
  if (!config.sound) return
  try {
    const ac = getContext()
    if (!ac) return
    const gain = ac.createGain()
    gain.gain.value = 0.045
    gain.connect(ac.destination)

    const osc = ac.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, ac.currentTime)
    osc.frequency.exponentialRampToValueAtTime(520, ac.currentTime + 0.035)
    gain.gain.setValueAtTime(0.045, ac.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.045)
    osc.connect(gain)
    osc.start()
    osc.stop(ac.currentTime + 0.06)
  } catch {
    /* ignore */
  }
}

/** 删除提示音(低沉的 "噗") */
export function playDelete() {
  if (!config.sound) return
  try {
    const ac = getContext()
    if (!ac) return
    const gain = ac.createGain()
    gain.gain.value = 0.05
    gain.connect(ac.destination)

    const osc = ac.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(220, ac.currentTime)
    osc.frequency.exponentialRampToValueAtTime(60, ac.currentTime + 0.07)
    gain.gain.setValueAtTime(0.05, ac.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.09)
    osc.connect(gain)
    osc.start()
    osc.stop(ac.currentTime + 0.1)
  } catch {
    /* ignore */
  }
}
