import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import * as CANNON from 'cannon-es'
import {
  buildDomino, removeDomino, generateId, resetIdCounter, syncIdCounter,
  DominoData, DominoObject, dominoW, dominoH, dominoD, getBoxGeometry,
} from './domino'
import { config, getSelectedColor, dominoSize, dominoSpacing } from './config'
import {
  createPhysicsWorld, activatePhysics, toppleDominoAt, resetPhysics, facingVector,
} from './physics'
import { saveToLocal } from './storage'
import { playPlace, playDelete, playImpact, unlockAudio } from './sound'
import { TEMPLATES, TemplateDef } from './templates'

export type ToolMode = 'place' | 'move' | 'delete'

const BOUNDARY = 9          // 放置边界(±9)
const DRAG_THRESHOLD = 0.2  // 拖拽判定阈值(世界单位)
const UNDO_LIMIT = 100

interface Gesture {
  pointerId: number
  kind: 'place' | 'move' | 'delete'
  startPos: THREE.Vector3
  lastPlaced: THREE.Vector3 | null
  moved: boolean
  movedDomino: DominoObject | null
  deletedIds: Set<number>
  startSnapshot: DominoData[]
}

export class DominoScene {
  private scene!: THREE.Scene
  private camera!: THREE.PerspectiveCamera
  private renderer!: THREE.WebGLRenderer
  private controls!: OrbitControls
  private world!: CANNON.World

  private dominoes: DominoObject[] = []
  private clock = new THREE.Clock()

  // 工具状态
  private toolMode: ToolMode = 'place'
  private isPlaying = false
  private toppleTriggered = false
  private pendingRotation = 0

  // 手势 / 悬停
  private gesture: Gesture | null = null
  private hoveredDomino: DominoObject | null = null
  private hoverHighlight: THREE.Mesh | null = null
  private ghost: THREE.Mesh | null = null
  private ghostMarker: THREE.Mesh | null = null
  private ghostVisible = false

  // 射线
  private raycaster = new THREE.Raycaster()
  private mouse = new THREE.Vector2()
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

  // 撤销 / 重做
  private undoStack: DominoData[][] = []
  private redoStack: DominoData[][] = []

  // 回调
  private onCountChange: (n: number) => void = () => {}
  private onPlayChange: (playing: boolean) => void = () => {}
  private onRotationChange: (angle: number) => void = () => {}
  private onHistoryChange: () => void = () => {}
  private onToolChange: (mode: ToolMode) => void = () => {}

  constructor(container: HTMLElement) {
    this.init(container)
    this.startLoop()
  }

  setCallbacks(cbs: {
    onCountChange?: (n: number) => void
    onPlayChange?: (playing: boolean) => void
    onRotationChange?: (angle: number) => void
    onHistoryChange?: () => void
    onToolChange?: (mode: ToolMode) => void
  }) {
    if (cbs.onCountChange) this.onCountChange = cbs.onCountChange
    if (cbs.onPlayChange) this.onPlayChange = cbs.onPlayChange
    if (cbs.onRotationChange) this.onRotationChange = cbs.onRotationChange
    if (cbs.onHistoryChange) this.onHistoryChange = cbs.onHistoryChange
    if (cbs.onToolChange) this.onToolChange = cbs.onToolChange
  }

  // ======== 初始化 ========
  private init(container: HTMLElement) {
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0xeaf2fb)
    this.scene.fog = new THREE.Fog(0xeaf2fb, 28, 65)

    const aspect = container.clientWidth / container.clientHeight
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 120)
    this.camera.position.set(9, 7, 10)
    this.camera.lookAt(0, 0.5, 0)

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.1
    container.appendChild(this.renderer.domElement)

    // 右键拖 = 旋转视角;中键拖 = 平移;滚轮 = 缩放
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.1
    this.controls.minDistance = 2
    this.controls.maxDistance = 40
    this.controls.maxPolarAngle = Math.PI / 2.02
    this.controls.target.set(0, 0.5, 0)
    this.controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    }
    // 触屏:单指留给操作,双指旋转/缩放
    this.controls.touches = {
      ONE: null as any,
      TWO: THREE.TOUCH.DOLLY_ROTATE as any,
    }

    this.world = createPhysicsWorld()

    this.setupLights()
    this.setupGround()
    this.setupEvents()

    this.containerEl = container
    window.addEventListener('resize', this.onResizeHandler)
  }

  private setupLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6)
    this.scene.add(ambient)
    const hemi = new THREE.HemisphereLight(0xdfe9ff, 0xf2e6d0, 0.9)
    this.scene.add(hemi)

    const sun = new THREE.DirectionalLight(0xfff6e0, 1.5)
    sun.position.set(8, 14, 6)
    sun.castShadow = true
    sun.shadow.mapSize.width = 2048
    sun.shadow.mapSize.height = 2048
    sun.shadow.camera.near = 0.5
    sun.shadow.camera.far = 40
    sun.shadow.camera.left = -14
    sun.shadow.camera.right = 14
    sun.shadow.camera.top = 14
    sun.shadow.camera.bottom = -14
    sun.shadow.bias = -0.0005
    this.scene.add(sun)

    const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5)
    fill.position.set(-6, 4, -8)
    this.scene.add(fill)
  }

  private setupGround() {
    const gridSize = 20
    const gridHelper = new THREE.GridHelper(gridSize, 20, 0xb9cbe0, 0xdde8f3)
    gridHelper.position.y = 0
    this.scene.add(gridHelper)

    const planeGeo = new THREE.PlaneGeometry(gridSize, gridSize)
    const planeMat = new THREE.MeshStandardMaterial({
      color: 0xf4f8fc,
      roughness: 0.95,
      metalness: 0,
    })
    const planeMesh = new THREE.Mesh(planeGeo, planeMat)
    planeMesh.rotation.x = -Math.PI / 2
    planeMesh.position.y = -0.005
    planeMesh.receiveShadow = true
    this.scene.add(planeMesh)
  }

  // ======== 事件 ========
  private setupEvents() {
    const canvas = this.renderer.domElement

    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e))
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e))
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e))
    canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e))
    canvas.addEventListener('pointerleave', () => {
      if (!this.gesture) this.hideGhost()
    })
    canvas.addEventListener('contextmenu', (e) => e.preventDefault())

    window.addEventListener('keydown', this.onKeyDownHandler)
  }

  /** 全局键盘快捷键(聚焦输入框时不响应) */
  private onKeyDownHandler = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null
    const tag = target?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return

    if (this.isPlaying) {
      if (e.key === 'Escape') this.resetPlay()
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) this.redo()
      else this.undo()
      return
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault()
      this.redo()
      return
    }
    if (e.key === '1') this.setTool('place')
    if (e.key === '2') this.setTool('move')
    if (e.key === '3') this.setTool('delete')
    if (e.key === 'r' || e.key === 'R') this.rotatePending()
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      this.deleteLast()
    }
    if (e.key === 'Escape') {
      // 取消进行中的手势并回滚到手势前状态
      const g = this.gesture
      this.gesture = null
      this.hideGhost()
      if (g) this.restore(g.startSnapshot)
    }
  }

  // ======== 射线工具 ========
  /** 确保相机世界矩阵与逆矩阵最新(相机被直接改位置后,matrixWorldInverse 要等渲染帧才更新) */
  private ensureCameraMatrix() {
    this.camera.updateMatrixWorld()
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert()
  }

  private groundHit(clientX: number, clientY: number): THREE.Vector3 | null {
    this.ensureCameraMatrix()
    this.mouse.x = (clientX / this.renderer.domElement.clientWidth) * 2 - 1
    this.mouse.y = -(clientY / this.renderer.domElement.clientHeight) * 2 + 1
    this.raycaster.setFromCamera(this.mouse, this.camera)
    const ray = this.raycaster.ray
    const denom = ray.direction.dot(this.groundPlane.normal)
    if (Math.abs(denom) < 1e-6) return null
    const t = -(ray.origin.dot(this.groundPlane.normal) + this.groundPlane.constant) / denom
    if (t < 0) return null
    const out = new THREE.Vector3().copy(ray.origin).addScaledVector(ray.direction, t)
    out.x = Math.max(-BOUNDARY, Math.min(BOUNDARY, out.x))
    out.z = Math.max(-BOUNDARY, Math.min(BOUNDARY, out.z))
    return out
  }

  private dominoHit(clientX: number, clientY: number): DominoObject | null {
    this.ensureCameraMatrix()
    this.mouse.x = (clientX / this.renderer.domElement.clientWidth) * 2 - 1
    this.mouse.y = -(clientY / this.renderer.domElement.clientHeight) * 2 + 1
    this.raycaster.setFromCamera(this.mouse, this.camera)
    const meshes = this.dominoes.map(d => d.mesh)
    const hits = this.raycaster.intersectObjects(meshes)
    if (hits.length === 0) return null
    const mesh = hits[0].object as THREE.Mesh
    return this.dominoes.find(d => d.mesh === mesh) ?? null
  }

  /** 网格吸附 */
  private snap(v: THREE.Vector3): THREE.Vector3 {
    if (!config.snap) return v
    const step = config.snapStep
    return new THREE.Vector3(
      Math.round(v.x / step) * step,
      0,
      Math.round(v.z / step) * step,
    )
  }

  // ======== Pointer 处理 ========
  private onPointerDown(e: PointerEvent) {
    unlockAudio()
    if (this.gesture) return

    // 鼠标:只处理左键;触屏:主触点
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if (e.pointerType !== 'mouse' && !e.isPrimary) return
    // 捕获指针,拖拽出画布也能收到事件
    try { this.renderer.domElement.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    canvasFocus(e)

    // —— 推倒模式:点击骨牌触发 ——
    if (this.isPlaying) {
      const domino = this.dominoHit(e.clientX, e.clientY)
      if (domino) {
        this.topple(domino)
      }
      return
    }

    const pos = this.groundHit(e.clientX, e.clientY)
    if (!pos) return

    if (this.toolMode === 'place') {
      const snapped = this.snap(pos)
      this.gesture = {
        pointerId: e.pointerId,
        kind: 'place',
        startPos: snapped,
        lastPlaced: null,
        moved: false,
        movedDomino: null,
        deletedIds: new Set(),
        startSnapshot: this.snapshot(),
      }
      this.hideGhost()
      this.renderer.domElement.style.cursor = 'crosshair'
    } else if (this.toolMode === 'move') {
      const domino = this.dominoHit(e.clientX, e.clientY)
      if (domino) {
        this.setHover(null)
        this.renderer.domElement.style.cursor = 'grabbing'
        this.gesture = {
          pointerId: e.pointerId,
          kind: 'move',
          startPos: pos.clone(),
          lastPlaced: null,
          moved: false,
          movedDomino: domino,
          deletedIds: new Set(),
          startSnapshot: this.snapshot(),
        }
      }
    } else if (this.toolMode === 'delete') {
      const domino = this.dominoHit(e.clientX, e.clientY)
      if (domino) {
        // 先记录手势前快照,再删除(保证撤销点正确)
        this.gesture = {
          pointerId: e.pointerId,
          kind: 'delete',
          startPos: pos.clone(),
          lastPlaced: null,
          moved: false,
          movedDomino: null,
          deletedIds: new Set([domino.data.id]),
          startSnapshot: this.snapshot(),
        }
        this.deleteDominoAt(domino)
        this.renderer.domElement.style.cursor = 'pointer'
      }
    }
  }

  private onPointerMove(e: PointerEvent) {
    // 右键旋转视角时不做交互
    if (e.pointerType === 'mouse' && (e.buttons & 2)) {
      this.hideGhost()
      return
    }

    const g = this.gesture

    // —— 推倒模式:悬停高亮 ——
    if (this.isPlaying && !g) {
      const domino = this.dominoHit(e.clientX, e.clientY)
      if (domino !== this.hoveredDomino) {
        this.setHover(domino)
        this.renderer.domElement.style.cursor = domino ? 'pointer' : 'default'
      }
      return
    }

    if (!g) {
      // 放置模式:更新 ghost 预览
      if (this.toolMode === 'place' && !this.isPlaying) {
        const pos = this.groundHit(e.clientX, e.clientY)
        if (pos) this.showGhost(this.snap(pos))
        else this.hideGhost()
      }
      return
    }

    if (e.pointerId !== g.pointerId) return
    const pos = this.groundHit(e.clientX, e.clientY)
    if (!pos) return

    if (g.kind === 'place') {
      this.placeDrag(g, pos)
    } else if (g.kind === 'move') {
      this.moveDrag(g, pos)
    } else if (g.kind === 'delete') {
      const domino = this.dominoHit(e.clientX, e.clientY)
      if (domino && !g.deletedIds.has(domino.data.id)) {
        g.deletedIds.add(domino.data.id)
        this.deleteDominoAt(domino)
      }
    }
  }

  private onPointerUp(e: PointerEvent) {
    const g = this.gesture
    if (!g || e.pointerId !== g.pointerId) return
    this.gesture = null

    let changed = this.snapshot().length !== g.startSnapshot.length
      || this.snapshotChanged(g.startSnapshot)

    if (g.kind === 'place') {
      if (!g.moved) {
        // 单击:用当前方向放一块
        this.placeDominoAt(g.startPos.x, g.startPos.z, this.pendingRotation)
        changed = true
      }
      this.renderer.domElement.style.cursor = 'crosshair'
    } else if (g.kind === 'move') {
      this.renderer.domElement.style.cursor = g.moved ? 'default' : 'grab'
    }

    if (changed) this.commit(g.startSnapshot)
    else this.hideGhost()

    // 恢复当前工具的光标
    if (!this.isPlaying) {
      this.renderer.domElement.style.cursor = this.toolMode === 'place' ? 'crosshair'
        : this.toolMode === 'move' ? 'grab' : 'default'
    }
  }

  // ======== 手势逻辑 ========
  private placeDrag(g: Gesture, pos: THREE.Vector3) {
    const dx = pos.x - g.startPos.x
    const dz = pos.z - g.startPos.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    if (!g.moved) {
      if (dist < DRAG_THRESHOLD) return
      g.moved = true
      // 起点块:朝向拖拽方向(骨牌前方 = 拖拽方向,连锁沿拖拽线)
      const angle = Math.atan2(dx, dz)
      g.lastPlaced = g.startPos.clone()
      this.placeDominoAt(g.startPos.x, g.startPos.z, angle)
      playPlace()
    }

    // 从上次放置点朝当前指针位置逐步铺排
    const spacing = dominoSpacing()
    let guard = 0
    while (g.lastPlaced && guard < 1000) {
      const lx = g.lastPlaced.x
      const lz = g.lastPlaced.z
      const ddx = pos.x - lx
      const ddz = pos.z - lz
      const stepDist = Math.sqrt(ddx * ddx + ddz * ddz)
      if (stepDist < spacing) break
      const angle = Math.atan2(ddx, ddz)
      const nx = Math.max(-BOUNDARY, Math.min(BOUNDARY, lx + (ddx / stepDist) * spacing))
      const nz = Math.max(-BOUNDARY, Math.min(BOUNDARY, lz + (ddz / stepDist) * spacing))
      // 卡在场景边界(clamp 后原地不动):停止铺排,避免骨牌重叠堆叠
      if (nx === lx && nz === lz) break
      g.lastPlaced = new THREE.Vector3(nx, 0, nz)
      this.placeDominoAt(nx, nz, angle)
      playPlace()
      guard++
    }
  }

  private moveDrag(g: Gesture, pos: THREE.Vector3) {
    const d = g.movedDomino
    if (!d) return
    const target = this.snap(pos)
    d.data.x = target.x
    d.data.z = target.z
    const h2 = dominoH(d.data) / 2
    d.mesh.position.set(target.x, h2, target.z)
    d.body.position.set(target.x, h2, target.z)
    g.moved = true
  }

  // ======== 骨牌操作 ========
  placeDominoAt(x: number, z: number, rotation: number) {
    if (this.isPlaying) return
    x = Math.max(-BOUNDARY, Math.min(BOUNDARY, x))
    z = Math.max(-BOUNDARY, Math.min(BOUNDARY, z))
    const data: DominoData = {
      id: generateId(),
      x, z,
      rotation,
      color: getSelectedColor(),
    }
    const obj = buildDomino(this.scene, this.world, data)
    this.dominoes.push(obj)
    this.onCountChange(this.dominoes.length)
  }

  deleteDominoAt(obj: DominoObject) {
    const idx = this.dominoes.indexOf(obj)
    if (idx === -1) return
    removeDomino(obj, this.scene, this.world)
    this.dominoes.splice(idx, 1)
    this.onCountChange(this.dominoes.length)
    playDelete()
    if (this.hoveredDomino === obj) this.setHover(null)
  }

  /** 删除最近放置的一块(Delete 键) */
  deleteLast() {
    if (this.isPlaying || this.dominoes.length === 0) return
    const prev = this.snapshot()
    const last = this.dominoes[this.dominoes.length - 1]
    this.deleteDominoAt(last)
    this.commit(prev)
  }

  // ======== 推倒 ========
  private topple(domino: DominoObject) {
    if (!this.toppleTriggered) {
      activatePhysics(this.dominoes)
      for (const d of this.dominoes) {
        this.setupCollisionSound(d.body)
      }
      this.toppleTriggered = true
    }
    // 朝骨牌前方推倒,连锁沿前方传导
    ;(domino.body as any).__falling = true
    toppleDominoAt(domino, facingVector(domino.data.rotation))
    this.setHover(null)
  }

  private setupCollisionSound(body: CANNON.Body) {
    // 幂等:同一刚体只注册一次(每轮播放都会调用,匿名函数引用去重无效)
    if ((body as any).__soundSetup) return
    ;(body as any).__soundSetup = true
    body.addEventListener(CANNON.Body.COLLIDE_EVENT_NAME, (event: any) => {
      if (body.type !== CANNON.Body.DYNAMIC) return
      try {
        const contact = event.contact
        const impactVel = contact.getImpactVelocityAlongNormal()
        if (Math.abs(impactVel) > 0.4) {
          playImpact(Math.min(1, Math.abs(impactVel) / 8))
        }
        // 碰撞助推:cannon 的接触求解会让倒下骨牌与下一块"粘滞锁死",
        // 连锁能量被整条锁链均摊而衰减(约 3-4 块即断)。
        // 检测到骨牌间撞击时,标记被撞骨牌为"倒下中",主循环会
        // 持续给它注入绕底边的角速度,直到它躺平,连锁因此稳定传播。
        const a: CANNON.Body = contact.bi
        const b: CANNON.Body = contact.bj
        if (!a || !b || a.type !== CANNON.Body.DYNAMIC || b.type !== CANNON.Body.DYNAMIC) return
        // 撞击门槛:轻微接触(堆叠/抖动)不触发
        if (Math.abs(impactVel) < 0.3) return
        // 被撞者 = 更竖直的一方(位置更高)
        const target = a.position.y >= b.position.y ? a : b
        if (!(target as any).__dominoData) return
        // 只标记还没躺平的骨牌(被压着的也需要继续倒下)
        if (target.position.y < 0.3) return
        // 节流:同一目标 100ms 内只触发一次
        const now = performance.now()
        if (now - ((target as any).__lastBoost ?? 0) < 100) return
        ;(target as any).__lastBoost = now
        ;(target as any).__falling = true
        // 立即给被撞骨牌初始倒下角速度(沿自身前方轴),让传递干脆不拖沓
        const tData = (target as any).__dominoData
        if (tData) {
          const f2 = facingVector(tData.rotation)
          const a2 = new CANNON.Vec3(f2.z, 0, -f2.x)
          target.angularVelocity.set(a2.x * 2.5, 0, a2.z * 2.5)
          target.wakeUp()
        }
      } catch {
        /* ignore */
      }
    })
  }

  /** 一键推倒:推倒第一块骨牌 */
  autoTopple() {
    if (this.dominoes.length === 0 || this.isPlaying) return
    this.gesture = null
    this.hideGhost()
    this.isPlaying = true
    this.toppleTriggered = false
    this.onPlayChange(true)
    this.renderer.domElement.style.cursor = 'crosshair'

    const first = this.dominoes[0]
    activatePhysics(this.dominoes)
    for (const d of this.dominoes) {
      this.setupCollisionSound(d.body)
    }
    this.toppleTriggered = true
    ;(first.body as any).__falling = true
    // 源头直接给倒下角速度(沿自身前方轴),确保第一块干脆倒下
    {
      const f = facingVector(first.data.rotation)
      const ax = new CANNON.Vec3(f.z, 0, -f.x)
      first.body.angularVelocity.set(ax.x * 2.5, 0, ax.z * 2.5)
      first.body.wakeUp()
    }
    toppleDominoAt(first, facingVector(first.data.rotation))
  }

  startPlay() {
    if (this.dominoes.length === 0 || this.isPlaying) return
    this.gesture = null
    this.hideGhost()
    this.isPlaying = true
    this.toppleTriggered = false
    this.onPlayChange(true)
    this.renderer.domElement.style.cursor = 'crosshair'
  }

  resetPlay() {
    if (!this.isPlaying) return
    this.gesture = null
    this.hideGhost()
    this.isPlaying = false
    this.toppleTriggered = false
    this.onPlayChange(false)
    resetPhysics(this.dominoes, this.world)
    this.setHover(null)
    this.renderer.domElement.style.cursor = ''
  }

  // ======== Ghost 预览 ========
  private showGhost(pos: THREE.Vector3) {
    if (!this.ghost || !this.ghostMarker) {
      const size = dominoSize()
      const geo = getBoxGeometry(size.w, size.h, size.d)
      const mat = new THREE.MeshBasicMaterial({
        color: getSelectedColor(),
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
      })
      this.ghost = new THREE.Mesh(geo, mat)
      this.ghost.visible = false
      this.scene.add(this.ghost)

      const markerGeo = new THREE.SphereGeometry(0.05, 8, 8)
      const markerMat = new THREE.MeshBasicMaterial({
        color: getSelectedColor(),
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      })
      this.ghostMarker = new THREE.Mesh(markerGeo, markerMat)
      this.ghostMarker.visible = false
      this.scene.add(this.ghostMarker)
    }

    const ghost = this.ghost!
    const marker = this.ghostMarker!
    const size = dominoSize()
    const ghostMat = ghost.material as THREE.MeshBasicMaterial
    ghostMat.color.setHex(getSelectedColor())
    ;(marker.material as THREE.MeshBasicMaterial).color.setHex(getSelectedColor())

    // 尺寸变化时更新几何体
    const key = `${size.w.toFixed(3)}:${size.h.toFixed(3)}:${size.d.toFixed(3)}`
    if (ghost.geometry !== getBoxGeometry(size.w, size.h, size.d)) {
      ghost.geometry = getBoxGeometry(size.w, size.h, size.d)
    }

    const h2 = size.h / 2
    ghost.position.set(pos.x, h2, pos.z)
    ghost.rotation.set(0, this.pendingRotation, 0)
    ghost.visible = true
    marker.position.set(
      pos.x + Math.sin(this.pendingRotation) * (size.d / 2 + 0.06),
      h2,
      pos.z + Math.cos(this.pendingRotation) * (size.d / 2 + 0.06),
    )
    marker.visible = true
    this.ghostVisible = true
  }

  private hideGhost() {
    if (!this.ghostVisible) return
    this.ghostVisible = false
    if (this.ghost) this.ghost.visible = false
    if (this.ghostMarker) this.ghostMarker.visible = false
  }

  // ======== Hover 高亮 ========
  private setHover(obj: DominoObject | null) {
    if (obj === this.hoveredDomino) return
    this.hoveredDomino = obj
    this.removeHoverHighlight()
    if (obj) this.showHoverHighlight(obj)
  }

  private showHoverHighlight(obj: DominoObject) {
    const w = dominoW(obj.data)
    const h = dominoH(obj.data)
    const d = dominoD(obj.data)
    const geo = getBoxGeometry(w + 0.06, h + 0.06, d + 0.06)
    const mat = new THREE.MeshBasicMaterial({
      color: 0x6366f1,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    })
    this.hoverHighlight = new THREE.Mesh(geo, mat)
    this.hoverHighlight.position.copy(obj.mesh.position)
    this.hoverHighlight.quaternion.copy(obj.mesh.quaternion)
    this.scene.add(this.hoverHighlight)
  }

  private removeHoverHighlight() {
    if (this.hoverHighlight) {
      this.scene.remove(this.hoverHighlight)
      const mat = this.hoverHighlight.material
      if (Array.isArray(mat)) mat.forEach(m => m.dispose())
      else mat.dispose()
      this.hoverHighlight = null
    }
  }

  // ======== 工具 ========
  setTool(mode: ToolMode) {
    if (this.isPlaying) return
    this.toolMode = mode
    this.gesture = null
    this.setHover(null)
    if (mode !== 'place') this.hideGhost()
    this.onToolChange(this.toolMode)
  }

  /** 重建物理世界(高级参数:摩擦/弹性修改后调用) */
  rebuildPhysicsWorld() {
    if (this.isPlaying) return
    for (const d of this.dominoes) {
      this.world.removeBody(d.body)
    }
    this.world = createPhysicsWorld()
    for (const d of this.dominoes) {
      this.world.addBody(d.body)
    }
  }

  getTool(): ToolMode { return this.toolMode }
  getPendingRotation(): number { return this.pendingRotation }

  rotatePending() {
    this.pendingRotation = (this.pendingRotation + Math.PI / 4) % (Math.PI * 2)
    this.onRotationChange(this.pendingRotation)
    // 让 ghost 预览立即旋转
    if (this.ghostVisible && this.ghost && this.ghostMarker) {
      const size = dominoSize()
      const h2 = size.h / 2
      this.ghost.rotation.set(0, this.pendingRotation, 0)
      this.ghostMarker.position.set(
        this.ghost.position.x + Math.sin(this.pendingRotation) * (size.d / 2 + 0.06),
        h2,
        this.ghost.position.z + Math.cos(this.pendingRotation) * (size.d / 2 + 0.06),
      )
    }
  }

  // ======== 撤销 / 重做 ========
  private snapshot(): DominoData[] {
    return this.dominoes.map(d => ({ ...d.data }))
  }

  private snapshotChanged(prev: DominoData[]): boolean {
    const cur = this.dominoes
    if (cur.length !== prev.length) return true
    for (let i = 0; i < cur.length; i++) {
      const a = cur[i].data
      const b = prev[i]
      if (a.id !== b.id || a.x !== b.x || a.z !== b.z || a.rotation !== b.rotation || a.color !== b.color) {
        return true
      }
    }
    return false
  }

  /** 手势结束后提交:记录撤销点 + 自动保存 */
  private commit(prev: DominoData[]) {
    this.undoStack.push(prev)
    if (this.undoStack.length > UNDO_LIMIT) this.undoStack.shift()
    this.redoStack.length = 0
    this.onHistoryChange()
    saveToLocal(this.snapshot())
  }

  canUndo(): boolean { return this.undoStack.length > 0 && !this.isPlaying }
  canRedo(): boolean { return this.redoStack.length > 0 && !this.isPlaying }

  undo() {
    if (!this.canUndo()) return
    this.redoStack.push(this.snapshot())
    this.restore(this.undoStack.pop()!)
    this.onHistoryChange()
    saveToLocal(this.snapshot())
  }

  redo() {
    if (!this.canRedo()) return
    this.undoStack.push(this.snapshot())
    this.restore(this.redoStack.pop()!)
    this.onHistoryChange()
    saveToLocal(this.snapshot())
  }

  private restore(data: DominoData[]) {
    for (const d of [...this.dominoes]) {
      removeDomino(d, this.scene, this.world)
    }
    this.dominoes = []
    this.setHover(null)
    let maxId = 0
    for (const d of data) {
      if (d.id > maxId) maxId = d.id
      const obj = buildDomino(this.scene, this.world, { ...d })
      this.dominoes.push(obj)
    }
    syncIdCounter(maxId)
    this.onCountChange(this.dominoes.length)
  }

  // ======== 清空 / 模板 ========
  hasDominoes(): boolean { return this.dominoes.length > 0 }

  clearAll() {
    if (this.isPlaying || this.dominoes.length === 0) return
    const prev = this.snapshot()
    for (const d of [...this.dominoes]) {
      removeDomino(d, this.scene, this.world)
    }
    this.dominoes = []
    resetIdCounter()
    this.setHover(null)
    this.hideGhost()
    this.onCountChange(0)
    this.commit(prev)
  }

  applyTemplate(templateName: string) {
    if (this.isPlaying) return
    const tmpl = TEMPLATES.find(t => t.name === templateName)
    if (!tmpl) return

    const prev = this.snapshot()
    for (const d of [...this.dominoes]) {
      removeDomino(d, this.scene, this.world)
    }
    this.dominoes = []
    this.setHover(null)
    resetIdCounter()

    let maxId = 0
    for (const d of tmpl.generate()) {
      if (d.id > maxId) maxId = d.id
      const obj = buildDomino(this.scene, this.world, d)
      this.dominoes.push(obj)
    }
    syncIdCounter(maxId)
    this.onCountChange(this.dominoes.length)
    this.commit(prev)
    this.fitCamera()
  }

  getTemplates(): TemplateDef[] {
    return TEMPLATES
  }

  // ======== 保存 / 加载 ========
  /** 导出当前全部骨牌数据 */
  exportData(): DominoData[] {
    return this.snapshot()
  }

  /** 用数据整体替换当前场景(加载/导入) */
  replaceAll(data: DominoData[]) {
    if (this.isPlaying) return false
    const prev = this.snapshot()
    for (const d of [...this.dominoes]) {
      removeDomino(d, this.scene, this.world)
    }
    this.dominoes = []
    this.setHover(null)
    resetIdCounter()
    let maxId = 0
    for (const d of data) {
      if (d.id > maxId) maxId = d.id
      const obj = buildDomino(this.scene, this.world, { ...d })
      this.dominoes.push(obj)
    }
    syncIdCounter(maxId)
    this.onCountChange(this.dominoes.length)
    this.commit(prev)
    this.fitCamera()
    return true
  }

  // ======== 相机取景 ========
  fitCamera() {
    if (this.dominoes.length === 0) {
      this.camera.position.set(9, 7, 10)
      this.controls.target.set(0, 0.5, 0)
      this.controls.update()
      return
    }
    const box = new THREE.Box3()
    for (const d of this.dominoes) {
      box.expandByObject(d.mesh)
    }
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const radius = Math.max(size.x, size.z, size.y / 2) / 2
    // 按垂直视场角计算距离,让整体恰好入画(带 25% 留白)
    const fov = this.camera.fov * Math.PI / 180
    const dist = radius / Math.tan(fov / 2) * 1.25
    const dir = new THREE.Vector3(0.6, 0.55, 0.9).normalize()
    this.camera.position.copy(center).addScaledVector(dir, dist)
    this.controls.target.copy(center)
    this.controls.update()
  }

  // ======== 主循环 ========
  private startLoop() {
    const animate = () => {
      requestAnimationFrame(animate)
      const dt = this.clock.getDelta()
      this.controls.update()

      if (this.isPlaying) {
        // 物理按真实时间推进:子步数 = 需要追赶的物理步数(低帧率时也不超速/不慢动作)
        const substeps = Math.max(1, Math.min(20, Math.ceil(dt * 60)))
        this.world.step(1 / 60, Math.min(dt, 0.5), substeps)
        // 倒下传递:骨牌倾斜到"顶端足以碰到下一块"时,前方竖直骨牌才会被传染。
        // 传递窗口取倾角 ~32°-51°(中心 y 0.68→0.5),保证碰撞事件偶发丢失时链条不断,
        // 但不会在刚被推倒时就提前传染 —— 连锁必须是"碰到才倒"的传递。
        for (const d of this.dominoes) {
          const body = d.body as any
          if (!body.__falling) continue
          if (body.position.y < 0.42) continue   // 已躺平,停止参与
          if (body.position.y > 0.70) continue  // 还没倒够,顶端尚未触及下一块
          const fwd = facingVector(d.data.rotation)
          for (const o of this.dominoes) {
            if (o === d) continue
            const ob = o.body as any
            if (ob.__falling || ob.position.y < 0.5) continue
            const dx = ob.position.x - body.position.x
            const dz = ob.position.z - body.position.z
            const proj = dx * fwd.x + dz * fwd.z
            if (proj < 0.05 || proj > 1.6) continue
            const perp = Math.abs(dx * fwd.z - dz * fwd.x)
            if (perp < 0.55) ob.__falling = true
          }
        }
        for (const d of this.dominoes) {
          // 脚本化倒下:被撞倒的骨牌每帧绕底边旋转 quaternion。
          // cannon 的接触求解会对"站立盒子绕底边旋转"施加过度约束
          // (底面角压入地面被强力阻止),角速度注入会被抵消;直接旋转
          // quaternion 绕过阻碍,倒下必然发生。角速度同步给 cannon,
          // 保证碰撞推下一块时接触响应正确。倒下超过 ~65% 后交给
          // 物理惯性完成,避免过冲翻转。
          const body = d.body as any
          if (body.__falling && body.position.y > 0.3) {
            const fwd = facingVector(d.data.rotation)
            const axis = new CANNON.Vec3(fwd.z, 0, -fwd.x)
            const omega = 1.1
            const step = Math.min(dt, 0.04)
            const half = omega * step * 0.5
            const qw = Math.cos(half)
            const qx = axis.x * Math.sin(half)
            const qy = axis.y * Math.sin(half)
            const qz = axis.z * Math.sin(half)
            const q = body.quaternion
            // 世界左乘:q_new = axisQuat ⊗ q(绕世界轴旋转)
            const nx = qw * q.x + qx * q.w + qy * q.z - qz * q.y
            const ny = qw * q.y - qx * q.z + qy * q.w + qz * q.x
            const nz = qw * q.z + qx * q.y - qy * q.x + qz * q.w
            const nw = qw * q.w - qx * q.x - qy * q.y - qz * q.z
            q.set(nx, ny, nz, nw)
            q.normalize()
            // 贴地滚动:绕底边前角旋转,质心沿倒下方向同步平移
            // (绕质心旋转会让底边前滑/穿透,水平平移补上滚动的位移)
            const tData = (d as any).data
            const hh = (tData.h ?? 1.6) / 2
            const dd = (tData.d ?? 0.24) / 2
            const ly = {
              x: 2 * (q.x * q.y - q.w * q.z),
              y: 1 - 2 * (q.x * q.x + q.z * q.z),
              z: 2 * (q.y * q.z + q.w * q.x),
            }
            const ang = Math.acos(Math.max(-1, Math.min(1, ly.y)))
            const prevAng = (body as any).__lastAng ?? 0
            const delta = hh * (Math.sin(ang) - Math.sin(prevAng))
            body.position.x += fwd.x * delta
            body.position.z += fwd.z * delta
            body.position.y = hh * Math.cos(ang) + dd * Math.sin(ang)
            ;(body as any).__lastAng = ang
            // 角速度同步给 cannon(cannon 积分会叠加旋转,omega 已按半量设计;
            // 角速度同时让碰撞/接触检测保持正常,纯脚本旋转会导致 collide 丢失)
            body.angularVelocity.set(axis.x * omega, 0, axis.z * omega)
            body.wakeUp()
          }
          d.mesh.position.copy(d.body.position as unknown as THREE.Vector3)
          d.mesh.quaternion.copy(d.body.quaternion as unknown as THREE.Quaternion)
        }
      }

      this.renderer.render(this.scene, this.camera)
    }
    animate()
  }

  /** 窗口尺寸变化 */
  private onResizeHandler = () => {
    if (!this.containerEl) return
    const w = this.containerEl.clientWidth
    const h = this.containerEl.clientHeight
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h)
  }

  private containerEl: HTMLElement | null = null

  dispose() {
    this.renderer.dispose()
    this.controls.dispose()
    window.removeEventListener('resize', this.onResizeHandler)
    window.removeEventListener('keydown', this.onKeyDownHandler)
    this.removeHoverHighlight()
    if (this.ghost) {
      this.scene.remove(this.ghost)
      this.ghost.geometry.dispose()
      ;(this.ghost.material as THREE.Material).dispose()
    }
    if (this.ghostMarker) {
      this.scene.remove(this.ghostMarker)
      this.ghostMarker.geometry.dispose()
      ;(this.ghostMarker.material as THREE.Material).dispose()
    }
  }
}

/** 让 canvas 获得焦点以接收快捷键 */
function canvasFocus(e: PointerEvent) {
  const target = e.target as HTMLElement
  if (target && typeof target.focus === 'function') {
    try { target.focus({ preventScroll: true }) } catch { /* ignore */ }
  }
}
