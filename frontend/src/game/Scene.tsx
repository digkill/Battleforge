import { Environment, OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { Suspense, useMemo, useRef } from 'react'
import type { Group } from 'three'
import type {
  AttackOption,
  BattleField,
  BattleFighter,
  Hex,
  ReachableHex,
  Terrain,
} from './use-battle-socket'

// Модели лежат в public/models/<defId>/model.gltf — путь совпадает с ключом
// каталога юнитов на бэкенде, поэтому новый юнит требует только новой папки.
const MODEL_PATH = (defId: string) => `/models/${defId}/model.gltf`

const KNOWN_MODELS = ['warrior', 'mage', 'archer', 'healer', 'knight', 'assassin']

/**
 * Клип анимации по смыслу, а не по точному имени.
 *
 * Имена клипов у разных авторов моделей разные («Walk», «walk_cycle», «Run»),
 * поэтому искать одну строку бессмысленно — берём первое совпадение по списку
 * синонимов, а если модель статична, возвращаем undefined и вызывающий код
 * просто ничего не проигрывает.
 */
const CLIP_SYNONYMS: Record<string, string[]> = {
  idle: ['idle', 'stand', 'breath'],
  walk: ['walk', 'run', 'move'],
  attack: ['attack', 'hit', 'strike', 'slash'],
  die: ['die', 'death', 'dead'],
}

export function findClip(names: string[], kind: keyof typeof CLIP_SYNONYMS): string | undefined {
  const wanted = CLIP_SYNONYMS[kind]
  return names.find((n) => wanted.some((w) => n.toLowerCase().includes(w)))
}

const HEX_SIZE = 0.62

/**
 * Перевод offset-координат «odd-r» в координаты сцены.
 *
 * Ряды сдвинуты вправо на нечётных строках — тот же сдвиг, что и в расчётах
 * соседства на сервере, иначе клетки на экране разъедутся с логикой боя.
 */
function hexToWorld({ col, row }: Hex): [number, number] {
  const x = HEX_SIZE * Math.sqrt(3) * (col + 0.5 * (row & 1))
  const z = HEX_SIZE * 1.5 * row
  return [x, z]
}

const TERRAIN_STYLE: Record<Terrain, { color: string; height: number; rough: number }> = {
  plain: { color: '#4a5d3a', height: 0.12, rough: 0.95 },
  forest: { color: '#26401f', height: 0.34, rough: 1 },
  mountain: { color: '#6b6157', height: 0.72, rough: 0.85 },
  water: { color: '#1d3d5c', height: 0.06, rough: 0.25 },
}

function hexKey(h: Hex) {
  return `${h.col}:${h.row}`
}

function Tile({
  hex,
  terrain,
  reachable,
  onPick,
}: {
  hex: Hex
  terrain: Terrain
  reachable: boolean
  onPick: (h: Hex) => void
}) {
  const style = TERRAIN_STYLE[terrain]
  const [x, z] = hexToWorld(hex)

  return (
    <group position={[x, 0, z]}>
      <mesh
        position={[0, style.height / 2, 0]}
        onClick={(e) => {
          if (!reachable) return
          e.stopPropagation()
          onPick(hex)
        }}
      >
        {/* cylinderGeometry с шестью сегментами — это и есть гекс. Поворот на
            30° делает вершину направленной вверх, как требует раскладка odd-r. */}
        <cylinderGeometry args={[HEX_SIZE, HEX_SIZE, style.height, 6]} />
        <meshStandardMaterial
          color={style.color}
          roughness={style.rough}
          metalness={terrain === 'water' ? 0.35 : 0}
        />
      </mesh>

      {reachable && (
        <mesh position={[0, style.height + 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[HEX_SIZE * 0.62, 6]} />
          <meshBasicMaterial color="#e8c66a" transparent opacity={0.42} />
        </mesh>
      )}
    </group>
  )
}

function Field({
  field,
  reachable,
  onPick,
}: {
  field: BattleField
  reachable: ReachableHex[]
  onPick: (h: Hex) => void
}) {
  const reachableKeys = useMemo(
    () => new Set(reachable.map((h) => hexKey(h))),
    [reachable],
  )

  const tiles: React.ReactElement[] = []
  for (let row = 0; row < field.height; row++) {
    for (let col = 0; col < field.width; col++) {
      const hex = { col, row }
      tiles.push(
        <Tile
          key={hexKey(hex)}
          hex={hex}
          terrain={field.rows[row][col]}
          reachable={reachableKeys.has(hexKey(hex))}
          onPick={onPick}
        />,
      )
    }
  }
  return <>{tiles}</>
}

function UnitModel({
  unit,
  active,
  attackable,
  onPick,
}: {
  unit: BattleFighter
  active: boolean
  attackable: boolean
  onPick: (targetId: string) => void
}) {
  const group = useRef<Group>(null)
  const { scene } = useGLTF(MODEL_PATH(unit.defId))

  // Каждый юнит на поле — независимый объект, а useGLTF отдаёт один и тот же
  // кэшированный граф на все вызовы с этим путём. Без копии два бойца одного
  // типа делили бы один трансформ и стояли бы друг в друге.
  const model = useMemo(() => scene.clone(true), [scene])

  const alive = unit.currentHp > 0
  const [x, z] = hexToWorld(unit.pos)
  // Сторона B развёрнута навстречу — иначе оба отряда смотрели бы в одну сторону.
  const facing = unit.side === 0 ? Math.PI / 2 : -Math.PI / 2

  useFrame((state, delta) => {
    const g = group.current
    if (!g) return
    // Плавный переезд на новую клетку: сервер присылает конечную позицию, а
    // рывок между гексами читался бы как телепорт.
    g.position.x += (x - g.position.x) * Math.min(1, delta * 6)
    g.position.z += (z - g.position.z) * Math.min(1, delta * 6)

    const targetTilt = alive ? 0 : -Math.PI / 2
    g.rotation.x += (targetTilt - g.rotation.x) * Math.min(1, delta * 6)

    const bob = active && alive ? Math.sin(state.clock.elapsedTime * 3) * 0.05 : 0
    g.position.y = 0.14 + bob
  })

  return (
    <group ref={group} position={[x, 0.14, z]} rotation={[0, facing, 0]}>
      <primitive
        object={model}
        scale={0.5}
        onClick={(e: { stopPropagation: () => void }) => {
          if (!attackable) return
          e.stopPropagation()
          onPick(unit.instanceId)
        }}
      />
      {active && alive && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.3, 0.4, 24]} />
          <meshBasicMaterial color="#e8c66a" transparent opacity={0.9} />
        </mesh>
      )}
      {attackable && alive && (
        <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.42, 0.52, 24]} />
          <meshBasicMaterial color="#d24b3a" transparent opacity={0.9} />
        </mesh>
      )}
    </group>
  )
}

export function BattleScene({
  field,
  units,
  activeUnitId,
  reachable,
  attackable,
  onMove,
  onAttack,
}: {
  field: BattleField | null
  units: BattleFighter[]
  activeUnitId: string | null
  reachable: ReachableHex[]
  attackable: AttackOption[]
  onMove: (h: Hex) => void
  onAttack: (opt: AttackOption) => void
}) {
  const attackableById = useMemo(
    () => new Map(attackable.map((o) => [o.targetId, o])),
    [attackable],
  )

  // Камера смотрит вдоль поля с той стороны, где стоит игрок.
  const center = field
    ? hexToWorld({ col: Math.floor(field.width / 2), row: Math.floor(field.height / 2) })
    : [0, 0]

  return (
    <div className="h-80 w-full overflow-hidden rounded-lg border border-primary/25 bg-[#120e18] sm:h-[26rem]">
      <Canvas shadows camera={{ position: [center[0], 9, center[1] + 9], fov: 45 }}>
        <Suspense fallback={null}>
          <ambientLight intensity={0.75} />
          <directionalLight position={[6, 12, 6]} intensity={1.5} castShadow />
          <Environment preset="sunset" />

          {field && <Field field={field} reachable={reachable} onPick={onMove} />}

          {units.map((unit) => (
            <UnitModel
              key={unit.instanceId}
              unit={unit}
              active={unit.instanceId === activeUnitId}
              attackable={attackableById.has(unit.instanceId)}
              onPick={(id) => {
                const opt = attackableById.get(id)
                if (opt) onAttack(opt)
              }}
            />
          ))}
        </Suspense>
        <OrbitControls
          target={[center[0], 0, center[1]]}
          enablePan={false}
          minPolarAngle={Math.PI / 8}
          maxPolarAngle={Math.PI / 2.3}
          minDistance={6}
          maxDistance={22}
        />
      </Canvas>
    </div>
  )
}

/** Модель на поворотном круге — для карточки юнита в коллекции. */
function Turntable({ defId }: { defId: string }) {
  const group = useRef<Group>(null)
  const { scene } = useGLTF(MODEL_PATH(defId))
  const model = useMemo(() => scene.clone(true), [scene])

  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.5
  })

  return (
    <group ref={group} position={[0, -0.85, 0]}>
      <primitive object={model} scale={1.15} />
    </group>
  )
}

export function UnitPreview({ defId }: { defId: string }) {
  return (
    <div className="h-44 w-full overflow-hidden rounded-md bg-[#120e18]">
      <Canvas
        camera={{ position: [0, 0.35, 2.6], fov: 40 }}
        // Карточек в коллекции до шести, и каждая держит свой WebGL-контекст —
        // ограничиваем разрешение, иначе на мобильном это заметно по батарее.
        dpr={[1, 1.5]}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[2, 4, 3]} intensity={1.8} />
          <Environment preset="sunset" />
          <Turntable defId={defId} />
        </Suspense>
      </Canvas>
    </div>
  )
}

// Модели тянутся заранее: бой начинается сразу после матчмейкинга, и ждать
// загрузку уже во время первого хода — значит показать пустое поле.
KNOWN_MODELS.forEach((defId) => useGLTF.preload(MODEL_PATH(defId)))
