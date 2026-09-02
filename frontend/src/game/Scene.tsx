import { Environment, OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { Suspense, useMemo, useRef } from 'react'
import type { Group } from 'three'
import type { BattleFighter } from './use-battle-socket'

// Модели лежат в public/models/<defId>/model.gltf — путь совпадает с ключом
// каталога юнитов на бэкенде, поэтому новый юнит требует только новой папки.
const MODEL_PATH = (defId: string) => `/models/${defId}/model.gltf`

const KNOWN_MODELS = ['warrior', 'mage', 'archer', 'healer', 'knight', 'assassin']

/** Ряд юнитов: своя сторона ближе к камере, чужая — дальше и развёрнута к нам. */
const ROW_Z = { mine: 1.6, theirs: -1.6 }

function UnitModel({
  defId,
  position,
  facing,
  alive,
  active,
}: {
  defId: string
  position: [number, number, number]
  facing: number
  alive: boolean
  active: boolean
}) {
  const group = useRef<Group>(null)
  const { scene } = useGLTF(MODEL_PATH(defId))

  // Каждый юнит на арене — независимый объект, а useGLTF отдаёт один и тот же
  // кэшированный граф на все вызовы с этим путём. Без копии два бойца одного
  // типа делили бы один трансформ и стояли бы друг в друге.
  const model = useMemo(() => scene.clone(true), [scene])

  useFrame((state, delta) => {
    const g = group.current
    if (!g) return
    // Павшие заваливаются набок, живые стоят прямо.
    const targetTilt = alive ? 0 : -Math.PI / 2
    g.rotation.x += (targetTilt - g.rotation.x) * Math.min(1, delta * 6)
    // Чей ход — тот покачивается, чтобы его было видно без подписи.
    const bob = active && alive ? Math.sin(state.clock.elapsedTime * 3) * 0.06 : 0
    g.position.y = position[1] + bob
  })

  return (
    <group ref={group} position={position} rotation={[0, facing, 0]}>
      <primitive object={model} scale={0.9} />
      {active && alive && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.42, 0.55, 32]} />
          <meshBasicMaterial color="#c084fc" transparent opacity={0.85} />
        </mesh>
      )}
    </group>
  )
}

function Arena({
  mine,
  theirs,
  activeUnitId,
}: {
  mine: BattleFighter[]
  theirs: BattleFighter[]
  activeUnitId: string | null
}) {
  const rows: Array<{ units: BattleFighter[]; z: number; facing: number }> = [
    { units: mine, z: ROW_Z.mine, facing: 0 },
    { units: theirs, z: ROW_Z.theirs, facing: Math.PI },
  ]

  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 6, 4]} intensity={1.6} castShadow />
      <Environment preset="sunset" />

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <circleGeometry args={[4.5, 48]} />
        <meshStandardMaterial color="#1c1626" roughness={0.9} />
      </mesh>

      {rows.map(({ units, z, facing }) =>
        units.map((unit, i) => (
          <UnitModel
            key={unit.instanceId}
            defId={unit.defId}
            // Отряд центрируется независимо от размера: 1 юнит стоит по центру,
            // 3 — веером, и павшие не оставляют дыр в строю.
            position={[(i - (units.length - 1) / 2) * 1.5, 0, z]}
            facing={facing}
            alive={unit.currentHp > 0}
            active={unit.instanceId === activeUnitId}
          />
        )),
      )}
    </>
  )
}

export function BattleScene({
  mine,
  theirs,
  activeUnitId,
}: {
  mine: BattleFighter[]
  theirs: BattleFighter[]
  activeUnitId: string | null
}) {
  return (
    <div className="h-64 w-full overflow-hidden rounded-lg border bg-[#120e18] sm:h-80">
      <Canvas shadows camera={{ position: [0, 3.2, 5.4], fov: 45 }}>
        {/* Пока модели грузятся, арена просто пустая — падать в фолбэк на
            каждый кадр загрузки было бы заметнее, чем короткая пауза. */}
        <Suspense fallback={null}>
          <Arena mine={mine} theirs={theirs} activeUnitId={activeUnitId} />
        </Suspense>
        <OrbitControls
          enablePan={false}
          minPolarAngle={Math.PI / 6}
          maxPolarAngle={Math.PI / 2.2}
          minDistance={3.5}
          maxDistance={9}
        />
      </Canvas>
    </div>
  )
}

// Модели тянутся заранее: бой начинается сразу после матчмейкинга, и ждать
// загрузку уже во время первого хода — значит показать пустую арену.
KNOWN_MODELS.forEach((defId) => useGLTF.preload(MODEL_PATH(defId)))
