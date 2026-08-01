import * as THREE from 'three'
import * as CANNON from 'cannon-es'
import { config, dominoSize } from './config'

/** 一个骨牌的数据(可序列化,用于保存/撤销) */
export interface DominoData {
  id: number
  x: number
  z: number
  rotation: number
  color: number
  w?: number
  h?: number
  d?: number
}

/** 运行时对象:网格 + 物理刚体 */
export interface DominoObject {
  data: DominoData
  mesh: THREE.Mesh
  body: CANNON.Body
}

// —— 共享资源缓存:同尺寸同颜色的骨牌复用几何体/材质,避免频繁创建 ——
const geoCache = new Map<string, THREE.BoxGeometry>()
const matCache = new Map<number, THREE.MeshPhysicalMaterial>()

export function dominoW(d?: DominoData) { return d?.w ?? dominoSize().w }
export function dominoH(d?: DominoData) { return d?.h ?? dominoSize().h }
export function dominoD(d?: DominoData) { return d?.d ?? dominoSize().d }

export function getBoxGeometry(w: number, h: number, d: number): THREE.BoxGeometry {
  const key = `${w.toFixed(3)}:${h.toFixed(3)}:${d.toFixed(3)}`
  let geo = geoCache.get(key)
  if (!geo) {
    geo = new THREE.BoxGeometry(w, h, d)
    geoCache.set(key, geo)
  }
  return geo
}

export function getDominoMaterial(color: number): THREE.MeshPhysicalMaterial {
  let mat = matCache.get(color)
  if (!mat) {
    mat = new THREE.MeshPhysicalMaterial({
      color,
      roughness: 0.5,
      metalness: 0.05,
      clearcoat: 0.25,
      clearcoatRoughness: 0.35,
    })
    matCache.set(color, mat)
  }
  return mat
}

export function createDominoMesh(color: number, w: number, h: number, d: number): THREE.Mesh {
  const mesh = new THREE.Mesh(getBoxGeometry(w, h, d), getDominoMaterial(color))
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

// —— ID 管理 ——
let nextId = 1
export function generateId(): number { return nextId++ }
export function resetIdCounter() { nextId = 1 }
export function syncIdCounter(maxId: number) {
  if (maxId >= nextId) nextId = maxId + 1
}

// —— 构建 / 移除 ——
export function buildDomino(
  scene: THREE.Scene,
  world: CANNON.World,
  data: DominoData,
): DominoObject {
  data.w = data.w ?? dominoSize().w
  data.h = data.h ?? dominoSize().h
  data.d = data.d ?? dominoSize().d

  const mesh = createDominoMesh(data.color, data.w, data.h, data.d)
  const body = createBody(data.w, data.h, data.d)

  const h2 = data.h / 2
  body.position.set(data.x, h2, data.z)
  body.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), data.rotation)

  mesh.position.set(data.x, h2, data.z)
  mesh.rotation.y = data.rotation
  // 立即更新世界矩阵,保证刚创建的 mesh 可被 raycast 命中
  mesh.updateMatrixWorld()

  scene.add(mesh)
  world.addBody(body)
  return { data, mesh, body }
}

export function removeDomino(obj: DominoObject, scene: THREE.Scene, world: CANNON.World) {
  scene.remove(obj.mesh)
  world.removeBody(obj.body)
  // 几何体/材质为共享缓存,不在此处 dispose
}

/** 创建物理刚体(编辑态为 KINEMATIC,静止) */
export function createBody(w: number, h: number, d: number): CANNON.Body {
  const mat = new CANNON.Material('domino')
  const body = new CANNON.Body({
    mass: config.mass,
    material: mat,
    linearDamping: 0.05,
    angularDamping: config.angularDamping,
    shape: new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)),
  })
  body.type = CANNON.Body.KINEMATIC
  return body
}
