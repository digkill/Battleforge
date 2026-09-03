import { Environment, OrbitControls, useGLTF } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { Suspense, useEffect, useRef } from 'react'
import type { Group } from 'three'
import { MODEL_PATH, useModelAnimator, useNormalizedModel } from './Scene'
import { hexKey, type Lair, type World, type WorldHex, type WorldTerrain } from './worldmap'

const HEX_SIZE = 0.62

/**
 * Высота фигурки на карте. Задаётся в мировых единицах, а масштаб под неё
 * считает useNormalizedModel: у героя и оборотня исходные размеры отличаются
 * на порядки, и общий множитель тут не подобрать.
 */
const FIGURE_HEIGHT = 1.05
const CREEP_MODEL = MODEL_PATH('werewolf')
const HERO_MODEL = MODEL_PATH('knight')

/** Тот же перевод «odd-r», что и на боевом поле, — две системы координат не нужны. */
function hexToWorld({ col, row }: WorldHex): [number, number] {
  return [HEX_SIZE * Math.sqrt(3) * (col + 0.5 * (row & 1)), HEX_SIZE * 1.5 * row]
}

const TERRAIN_STYLE: Record<WorldTerrain, { color: string; height: number }> = {
  grass: { color: '#3f5a33', height: 0.12 },
  road: { color: '#7a6a4f', height: 0.1 },
  forest: { color: '#22401d', height: 0.36 },
  mountain: { color: '#6b6157', height: 0.8 },
  water: { color: '#1d3d5c', height: 0.05 },
}

function Tile({
  hex,
  terrain,
  highlighted,
  onPick,
}: {
  hex: WorldHex
  terrain: WorldTerrain
  highlighted: boolean
  onPick: (h: WorldHex) => void
}) {
  const style = TERRAIN_STYLE[terrain]
  const [x, z] = hexToWorld(hex)
  return (
    <group position={[x, 0, z]}>
      <mesh
        position={[0, style.height / 2, 0]}
        onClick={(e) => {
          e.stopPropagation()
          onPick(hex)
        }}
      >
        <cylinderGeometry args={[HEX_SIZE, HEX_SIZE, style.height, 6]} />
        <meshStandardMaterial
          color={style.color}
          roughness={terrain === 'water' ? 0.25 : 0.95}
          metalness={terrain === 'water' ? 0.35 : 0}
        />
      </mesh>
      {highlighted && (
        <mesh position={[0, style.height + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[HEX_SIZE * 0.55, 6]} />
          <meshBasicMaterial color="#e8c66a" transparent opacity={0.5} />
        </mesh>
      )}
    </group>
  )
}

/**
 * Герой. Плавно едет по переданному пути и разворачивается в сторону движения.
 *
 * Путь приходит целиком, а не по клетке: так шаг остаётся мгновенным для
 * логики (позиция уже обновлена), а на экране герой всё равно идёт.
 */
function Hero({ at, moving }: { at: WorldHex; moving: boolean }) {
  const group = useRef<Group>(null)
  const { scene, animations } = useGLTF(HERO_MODEL)
  const model = useNormalizedModel(scene, FIGURE_HEIGHT)
  const play = useModelAnimator(group, animations, scene)

  // Рыцарь пока статичен — клипов у него нет, и это нормально: проигрыватель
  // просто ничего не включит, а движение по-прежнему читается подпрыгиванием.
  useEffect(() => {
    play(moving ? 'walk' : 'idle')
  }, [moving, play])

  const [x, z] = hexToWorld(at)

  useFrame((state, delta) => {
    const g = group.current
    if (!g) return
    const dx = x - g.position.x
    const dz = z - g.position.z
    g.position.x += dx * Math.min(1, delta * 4)
    g.position.z += dz * Math.min(1, delta * 4)
    if (Math.abs(dx) + Math.abs(dz) > 0.02) {
      g.rotation.y = Math.atan2(dx, dz)
    }
    // Пока модель без анимации ходьбы — лёгкое подпрыгивание, чтобы движение
    // читалось. С анимированной моделью это станет незаметно на фоне клипа.
    g.position.y = 0.16 + (moving ? Math.abs(Math.sin(state.clock.elapsedTime * 8)) * 0.07 : 0)
  })

  return (
    <group ref={group} position={[x, 0.16, z]}>
      <primitive object={model} />
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.3, 0.4, 24]} />
        <meshBasicMaterial color="#e8c66a" transparent opacity={0.85} />
      </mesh>
    </group>
  )
}

/** Замок — простая башня из примитивов: отдельная модель под него не нужна. */
function Castle({ at, onPick }: { at: WorldHex; onPick: () => void }) {
  const [x, z] = hexToWorld(at)
  return (
    <group
      position={[x, 0.1, z]}
      onClick={(e) => {
        e.stopPropagation()
        onPick()
      }}
    >
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[0.62, 0.6, 0.62]} />
        <meshStandardMaterial color="#8a7b63" roughness={0.9} />
      </mesh>
      <mesh position={[0, 0.75, 0]}>
        <coneGeometry args={[0.42, 0.4, 6]} />
        <meshStandardMaterial color="#b1452f" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.42, 0.54, 24]} />
        <meshBasicMaterial color="#7fd1e8" transparent opacity={0.8} />
      </mesh>
    </group>
  )
}

function LairMarker({ lair, onPick }: { lair: Lair; onPick: (l: Lair) => void }) {
  const group = useRef<Group>(null)
  const { scene, animations } = useGLTF(CREEP_MODEL)
  const model = useNormalizedModel(scene, FIGURE_HEIGHT)
  const play = useModelAnimator(group, animations, scene)

  // На карте крип стоит в покое: отдельного idle у оборотня нет, и покой
  // изображается замедленной ходьбой — зверь переминается на месте.
  useEffect(() => {
    play('idle')
  }, [play])

  const [x, z] = hexToWorld(lair.at)

  return (
    <group ref={group} position={[x, 0.14, z]}>
      <primitive object={model} />
      {/* Отдельная область клика: луч по скелетному мешу проверяется по
          габаритам в позе привязки, которые у этой модели далеко от неё самой,
          поэтому клик по волку промахивался и попадал в клетку под ним. */}
      <mesh
        position={[0, FIGURE_HEIGHT / 2, 0]}
        onClick={(e) => {
          e.stopPropagation()
          onPick(lair)
        }}
      >
        <cylinderGeometry args={[0.42, 0.42, FIGURE_HEIGHT, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.36, 0.48, 24]} />
        <meshBasicMaterial color="#d24b3a" transparent opacity={0.85} />
      </mesh>
    </group>
  )
}

export function WorldScene({
  world,
  heroAt,
  moving,
  reachable,
  onPickHex,
  onPickLair,
  onPickCastle,
}: {
  world: World
  heroAt: WorldHex
  moving: boolean
  reachable: Set<string>
  onPickHex: (h: WorldHex) => void
  onPickLair: (l: Lair) => void
  onPickCastle: () => void
}) {
  // Кадрируем по геометрическому центру поля, а не по центральной клетке:
  // из-за сдвига нечётных рядов это разные точки, и карта уезжала вбок.
  const [maxX] = hexToWorld({ col: world.width - 1, row: 1 })
  const [, maxZ] = hexToWorld({ col: 0, row: world.height - 1 })
  const center: [number, number] = [maxX / 2, maxZ / 2]
  // Отдаление считается от размера карты, иначе при её изменении кадр ломается.
  const span = Math.max(maxX, maxZ)

  const tiles: React.ReactElement[] = []
  for (let row = 0; row < world.height; row++) {
    for (let col = 0; col < world.width; col++) {
      const hex = { col, row }
      tiles.push(
        <Tile
          key={hexKey(hex)}
          hex={hex}
          terrain={world.rows[row][col]}
          highlighted={reachable.has(hexKey(hex))}
          onPick={onPickHex}
        />,
      )
    }
  }

  return (
    <div className="h-[24rem] w-full overflow-hidden rounded-lg border border-primary/25 bg-[#0f0c14] sm:h-[32rem]">
      <Canvas shadows camera={{ position: [center[0], span * 0.7, center[1] + span * 0.62], fov: 45 }}>
        <Suspense fallback={null}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[8, 14, 6]} intensity={1.5} castShadow />
          <Environment preset="sunset" />
          {tiles}
          <Castle at={world.castle} onPick={onPickCastle} />
          {world.lairs
            .filter((l) => !l.cleared)
            .map((l) => (
              <LairMarker key={l.id} lair={l} onPick={onPickLair} />
            ))}
          <Hero at={heroAt} moving={moving} />
        </Suspense>
        <OrbitControls
          target={[center[0], 0, center[1]]}
          enablePan={false}
          minPolarAngle={Math.PI / 8}
          maxPolarAngle={Math.PI / 2.3}
          minDistance={span * 0.4}
          maxDistance={span * 2.2}
        />
      </Canvas>
    </div>
  )
}

useGLTF.preload(CREEP_MODEL)
useGLTF.preload(HERO_MODEL)
