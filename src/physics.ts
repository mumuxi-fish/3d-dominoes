import * as CANNON from 'cannon-es'
import { config, dominoSize } from './config'
import { DominoObject, createBody, dominoH } from './domino'

/** 创建物理世界(含地面) */
export function createPhysicsWorld(): CANNON.World {
  const world = new CANNON.World()
  world.gravity.set(0, -9.82, 0)
  world.broadphase = new CANNON.SAPBroadphase(world)
  world.allowSleep = true
  ;(world.solver as any).iterations = 12

  const defaultMat = new CANNON.Material('default')
  const dominoMat = new CANNON.Material('domino')
  const contactMat = new CANNON.ContactMaterial(defaultMat, defaultMat, {
    friction: config.friction,
    restitution: config.restitution,
  })
  world.addContactMaterial(contactMat)

  // 骨牌之间的接触材料(连锁的关键)
  const dominoContact = new CANNON.ContactMaterial(dominoMat, dominoMat, {
    friction: config.friction,
    restitution: config.restitution * 0.8,
  })
  world.addContactMaterial(dominoContact)
  const groundContact = new CANNON.ContactMaterial(dominoMat, defaultMat, {
    friction: config.friction,
    restitution: 0.05,
  })
  world.addContactMaterial(groundContact)

  // 地面
  const groundBody = new CANNON.Body({ mass: 0, material: defaultMat })
  groundBody.addShape(new CANNON.Plane())
  groundBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2)
  world.addBody(groundBody)

  return world
}

/** 激活全部骨牌的物理(静态 → 动态) */
export function activatePhysics(dominoes: DominoObject[]) {
  for (const d of dominoes) {
    d.body.type = CANNON.Body.DYNAMIC
    d.body.mass = config.mass
    d.body.updateMassProperties()
    d.body.wakeUp()
  }
}

/**
 * 推倒某块骨牌:在重心高处施加冲量
 * @param direction 世界空间推倒方向(归一化),骨牌将朝此方向倒下
 */
export function toppleDominoAt(target: DominoObject, direction: CANNON.Vec3) {
  const h = dominoH(target.data)
  const dir = direction.clone().scale(config.impulseStrength)
  const wp = new CANNON.Vec3(
    target.body.position.x,
    h * 0.8,
    target.body.position.z,
  )
  target.body.applyImpulse(dir, wp)
}

/** 复原:重建所有刚体,回到编辑态 */
export function resetPhysics(dominoes: DominoObject[], world: CANNON.World) {
  for (const d of dominoes) {
    world.removeBody(d.body)
  }
  for (const d of dominoes) {
    const h = dominoH(d.data)
    const newBody = createBody(d.data.w ?? dominoSize().w, h, d.data.d ?? dominoSize().d)
    newBody.position.set(d.data.x, h / 2, d.data.z)
    newBody.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), d.data.rotation)
    d.body = newBody
    world.addBody(newBody)

    d.mesh.position.set(d.data.x, h / 2, d.data.z)
    d.mesh.rotation.y = d.data.rotation
  }
}

/** 世界空间"前方"向量(骨牌局部 +z 轴) */
export function facingVector(rotation: number): CANNON.Vec3 {
  return new CANNON.Vec3(Math.sin(rotation), 0, Math.cos(rotation))
}
