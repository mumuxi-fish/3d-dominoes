import './style.css'
import { DominoScene } from './scene'
import { initUI } from './ui'
import { loadFromLocal } from './storage'

const container = document.getElementById('canvas-container')!
const scene = new DominoScene(container)

initUI(scene)

// 自动恢复上次的进度
const saved = loadFromLocal()
if (saved && saved.length > 0) {
  scene.replaceAll(saved)
}
