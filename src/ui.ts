import { DominoScene, ToolMode } from './scene'
import {
  config, COLOR_PRESETS, SIZE_PRESETS, GAP_PRESETS,
  SizeKey, GapKey,
} from './config'
import { saveToLocal, loadFromLocal, exportToFile, importFromFile } from './storage'

const $ = (id: string) => document.getElementById(id)!

function formatRotation(rad: number): string {
  const deg = Math.round(rad * 180 / Math.PI) % 360
  return deg === 0 ? '0°' : `${deg}°`
}

export function initUI(scene: DominoScene) {
  const countEl = $('domino-count')
  const statusBar = $('status-bar')

  // ======== Toast ========
  function toast(msg: string) {
    const old = document.querySelector('.toast')
    if (old) old.remove()
    const el = document.createElement('div')
    el.className = 'toast'
    el.textContent = msg
    document.body.appendChild(el)
    requestAnimationFrame(() => el.classList.add('show'))
    setTimeout(() => {
      el.classList.remove('show')
      setTimeout(() => el.remove(), 300)
    }, 1800)
  }

  // ======== 模式切换 ========
  const modeBtns = document.querySelectorAll<HTMLButtonElement>('#mode-group [data-tool]')
  function syncToolButtons(mode: ToolMode) {
    modeBtns.forEach(b => b.classList.toggle('active', b.dataset.tool === mode))
  }
  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      scene.setTool(btn.dataset.tool as ToolMode)
    })
  })

  // ======== 状态栏 ========
  const MODE_HINTS: Record<ToolMode, string> = {
    place: '左键单击放置 · 按住拖动连排 · R 旋转方向 · 右键拖动旋转视角',
    move: '按住骨牌拖动移动 · 右键拖动旋转视角',
    delete: '单击骨牌删除 · 按住拖动连删 · 右键拖动旋转视角',
  }
  function updateStatus(mode: ToolMode, rotation?: number) {
    let text = MODE_HINTS[mode]
    if (mode === 'place') {
      const rot = formatRotation(rotation ?? scene.getPendingRotation())
      text = `${text} · 方向 ${rot}`
    }
    statusBar.textContent = text
  }

  // ======== 色板(左栏)=======
  const colorPanel = $('color-panel')
  COLOR_PRESETS.forEach((c, i) => {
    const btn = document.createElement('button')
    btn.className = `color-btn${i === config.selectedColorIdx ? ' active' : ''}`
    btn.title = c.name
    btn.style.background = c.css
    btn.addEventListener('click', () => {
      config.selectedColorIdx = i
      colorPanel.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
    })
    colorPanel.appendChild(btn)
  })

  // ======== 设置面板 ========
  const settingsPanel = $('settings-panel')
  $('btn-settings').addEventListener('click', () => settingsPanel.classList.toggle('open'))
  document.addEventListener('click', (e) => {
    if (!settingsPanel.contains(e.target as Node) && (e.target as HTMLElement).id !== 'btn-settings') {
      settingsPanel.classList.remove('open')
    }
  })

  // 尺寸预设
  const sizeGroup = $('setting-size')
  ;(Object.keys(SIZE_PRESETS) as SizeKey[]).forEach(key => {
    const btn = document.createElement('button')
    btn.className = `seg-btn${config.sizeKey === key ? ' active' : ''}`
    btn.textContent = SIZE_PRESETS[key].label
    btn.addEventListener('click', () => {
      config.sizeKey = key
      sizeGroup.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      toast(`骨牌尺寸:${SIZE_PRESETS[key].label}(新放置生效)`)
    })
    sizeGroup.appendChild(btn)
  })

  // 间距预设
  const gapGroup = $('setting-gap')
  ;(Object.keys(GAP_PRESETS) as GapKey[]).forEach(key => {
    const btn = document.createElement('button')
    btn.className = `seg-btn${config.gapKey === key ? ' active' : ''}`
    btn.textContent = GAP_PRESETS[key].label
    btn.addEventListener('click', () => {
      config.gapKey = key
      gapGroup.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
    })
    gapGroup.appendChild(btn)
  })

  // 开关
  function bindToggle(id: string, get: () => boolean, set: (v: boolean) => void) {
    const btn = $(id)
    const refresh = () => btn.classList.toggle('on', get())
    btn.addEventListener('click', () => { set(!get()); refresh() })
    refresh()
  }
  bindToggle('toggle-snap', () => config.snap, v => { config.snap = v })
  bindToggle('toggle-sound', () => config.sound, v => { config.sound = v })

  // 高级物理参数
  const ADVANCED: { key: 'mass' | 'friction' | 'restitution' | 'angularDamping' | 'impulseStrength'; label: string; min: number; max: number; step: number }[] = [
    { key: 'mass', label: '质量', min: 0.05, max: 3, step: 0.05 },
    { key: 'friction', label: '摩擦', min: 0, max: 1, step: 0.05 },
    { key: 'restitution', label: '弹性', min: 0, max: 0.8, step: 0.05 },
    { key: 'angularDamping', label: '角阻尼', min: 0, max: 1, step: 0.05 },
    { key: 'impulseStrength', label: '推力', min: 0.1, max: 1.5, step: 0.05 },
  ]
  const advBody = $('advanced-body')
  ADVANCED.forEach(a => {
    const row = document.createElement('div')
    row.className = 'setting-row'
    const label = document.createElement('span')
    label.className = 'setting-label'
    label.textContent = a.label
    const val = document.createElement('span')
    val.className = 'setting-value'
    val.textContent = String(config[a.key].toFixed(2))
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = String(a.min)
    slider.max = String(a.max)
    slider.step = String(a.step)
    slider.value = String(config[a.key])
    slider.addEventListener('input', () => {
      config[a.key] = parseFloat(slider.value)
      val.textContent = config[a.key].toFixed(2)
    })
    slider.addEventListener('change', () => {
      if (a.key === 'friction' || a.key === 'restitution') {
        scene.rebuildPhysicsWorld()
        toast('物理参数已更新')
      }
    })
    row.append(label, slider, val)
    advBody.appendChild(row)
  })
  $('advanced-toggle').addEventListener('click', () => {
    $('advanced-body').classList.toggle('open')
  })

  // ======== 模板下拉 ========
  const templateMenu = $('template-menu')
  const btnTemplates = $('btn-templates')
  for (const tpl of scene.getTemplates()) {
    const item = document.createElement('button')
    item.className = 'template-menu-item'
    item.innerHTML = `<span class="tpl-icon">${tpl.icon}</span> ${tpl.name}`
    item.addEventListener('click', () => {
      templateMenu.classList.remove('open')
      if (scene.hasDominoes()) {
        if (!confirm(`将清空当前 ${scene.exportData().length} 块骨牌,生成「${tpl.name}」?`)) return
      }
      scene.applyTemplate(tpl.name)
      toast(`已生成「${tpl.name}」`)
    })
    templateMenu.appendChild(item)
  }
  btnTemplates.addEventListener('click', (e) => {
    e.stopPropagation()
    templateMenu.classList.toggle('open')
  })
  document.addEventListener('click', () => templateMenu.classList.remove('open'))
  templateMenu.addEventListener('click', (e) => e.stopPropagation())

  // ======== 存档菜单 ========
  const archiveMenu = $('archive-menu')
  const btnArchive = $('btn-archive')
  btnArchive.addEventListener('click', (e) => {
    e.stopPropagation()
    archiveMenu.classList.toggle('open')
  })
  document.addEventListener('click', () => archiveMenu.classList.remove('open'))
  archiveMenu.addEventListener('click', (e) => e.stopPropagation())

  $('act-save').addEventListener('click', () => {
    const ok = saveToLocal(scene.exportData())
    toast(ok ? '已保存到浏览器' : '保存失败')
    archiveMenu.classList.remove('open')
  })
  $('act-load').addEventListener('click', () => {
    const data = loadFromLocal()
    if (!data) {
      toast('没有找到存档')
    } else if (!scene.replaceAll(data)) {
      toast('推倒进行中,请先复原再加载')
    } else {
      toast(`已加载 ${data.length} 块骨牌`)
    }
    archiveMenu.classList.remove('open')
  })
  $('act-export').addEventListener('click', () => {
    exportToFile(scene.exportData())
    archiveMenu.classList.remove('open')
  })
  $('act-import').addEventListener('click', async () => {
    const data = await importFromFile()
    if (!data) {
      toast('导入失败:文件格式不正确')
    } else if (!scene.replaceAll(data)) {
      toast('推倒进行中,请先复原再导入')
    } else {
      toast(`已导入 ${data.length} 块骨牌`)
    }
    archiveMenu.classList.remove('open')
  })

  // ======== 推倒 / 复原 ========
  const btnPlay = $('btn-play')
  const btnReset = $('btn-reset')
  $('btn-play').addEventListener('click', () => scene.startPlay())
  $('btn-auto').addEventListener('click', () => scene.autoTopple())
  btnReset.addEventListener('click', () => scene.resetPlay())
  btnReset.style.display = 'none'

  // ======== 撤销 / 重做 ========
  const btnUndo = $('btn-undo') as HTMLButtonElement
  const btnRedo = $('btn-redo') as HTMLButtonElement
  btnUndo.addEventListener('click', () => scene.undo())
  btnRedo.addEventListener('click', () => scene.redo())
  function syncHistory() {
    btnUndo.disabled = !scene.canUndo()
    btnRedo.disabled = !scene.canRedo()
  }
  syncHistory()

  // ======== 清空 ========
  $('btn-clear').addEventListener('click', () => {
    if (!scene.hasDominoes()) return
    if (confirm(`确定清空全部 ${scene.exportData().length} 块骨牌吗?`)) {
      scene.clearAll()
      toast('已清空')
    }
  })

  // ======== 帮助 ========
  const helpOverlay = $('help-overlay')
  $('btn-help').addEventListener('click', () => helpOverlay.classList.add('open'))
  $('help-close').addEventListener('click', () => helpOverlay.classList.remove('open'))
  helpOverlay.addEventListener('click', (e) => {
    if (e.target === helpOverlay) helpOverlay.classList.remove('open')
  })

  // ======== 场景回调 ========
  scene.setCallbacks({
    onCountChange: (n) => {
      countEl.textContent = `🁎 ${n}`
    },
    onPlayChange: (playing) => {
      btnReset.style.display = playing ? 'inline-block' : 'none'
      btnPlay.textContent = playing ? '🎯 点击骨牌' : '▶ 推倒'
      btnPlay.classList.toggle('running', playing)
      modeBtns.forEach(b => b.disabled = playing)
      if (!playing) {
        const active = document.querySelector<HTMLButtonElement>('#mode-group [data-tool].active')
        updateStatus((active?.dataset.tool as ToolMode) ?? 'place')
      } else {
        statusBar.textContent = '点击任意骨牌开始推倒 · 再次点击继续 · Esc 复原'
      }
    },
    onRotationChange: (angle) => {
      const active = document.querySelector<HTMLButtonElement>('#mode-group [data-tool].active')
      if (active?.dataset.tool === 'place') updateStatus('place', angle)
    },
    onHistoryChange: syncHistory,
    onToolChange: (mode) => {
      syncToolButtons(mode)
      updateStatus(mode)
    },
  })

  // ======== 引导(首次访问)=======
  function showGuide() {
    helpOverlay.classList.add('open')
  }
  try {
    if (!localStorage.getItem('3d-dominoes-visited')) {
      localStorage.setItem('3d-dominoes-visited', '1')
      showGuide()
    }
  } catch { /* ignore */ }

  // ======== 初始状态 ========
  scene.setTool('place')
  updateStatus('place')
  countEl.textContent = '🁎 0'
}
