import * as CANNON from 'cannon-es'
import { config, dominoSize } from './config'
import { DominoObject, createBody, dominoH } from './domino'

/** 创建物理世界(含地面) */
export function createPhysicsWorld(): CANNON.World {
  const world = new CANNON.World()
  world.gravity.set(0, -9.82, 0)
  world.broadphase = new CANNON.SAPBroadphase(world)
  // 多米诺倒下依赖持续重力矩,骨牌短暂低速时入睡会冻结连锁,禁用睡眠
  world.allowSleep = false
  ;(world.solver as any).iterations = 30
  ;(world.solver as any).tolerance = 1e-6

  const defaultMat = new CANNON.Material('default')
  const dominoMat = new CANNON.Material('domino')
  // 接触刚度调低:刚性接触(默认 1e7)会让倒下的骨牌与下一块"粘滞锁死",
  // 连锁能量被整条锁链均摊而衰减。软接触允许骨牌碰撞后分离,连锁才能传播。
  const soft = { stiffness: 8e3, relaxation: 4 }
  const contactMat = new CANNON.ContactMaterial(defaultMat, defaultMat, {
    friction: config.friction,
    restitution: config.restitution,
    ...soft,
  })
  world.addContactMaterial(contactMat)

  // 骨牌之间的接触材料(连锁的关键)
  const dominoContact = new CANNON.ContactMaterial(dominoMat, dominoMat, {
    friction: config.friction,
    restitution: config.restitution * 0.8,
    ...soft,
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
 * 推倒某块骨牌:只注入绕底边的倒下角速度。
 * 注意:不能用 applyImpulse —— 它会同时给骨牌线速度,导致骨牌
 * "平移"滑向下一块、在还没倒下时就被推着提前接触,破坏传递感。
 * @param direction 世界空间倒下方向(归一化,骨牌前方)
 */
export function toppleDominoAt(target: DominoObject, direction: CANNON.Vec3) {
  const axis = new CANNON.Vec3(direction.z, 0, -direction.x)
  target.body.angularVelocity.set(axis.x * 2.5, 0, axis.z * 2.5)
  target.body.wakeUp()
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
    // 重置整个欧拉角:只设 rotation.y 会让倒下时的 x/z 分量残留,
    // mesh.quaternion 仍保持倒下姿态(复原后主循环不再同步 mesh)
    d.mesh.rotation.set(0, d.data.rotation, 0)
  }
}

/** 世界空间"前方"向量(骨牌局部 +z 轴) */
export function facingVector(rotation: number): CANNON.Vec3 {
  return new CANNON.Vec3(Math.sin(rotation), 0, Math.cos(rotation))
}
