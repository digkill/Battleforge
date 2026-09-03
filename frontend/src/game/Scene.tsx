import { OrbitControls, useAnimations, useGLTF } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box3,
  Group,
  LoopOnce,
  LoopRepeat,
  Vector3,
  type AnimationClip,
  type Object3D,
} from 'three'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import type {
  AttackOption,
  BattleField,
  BattleFighter,
  BattleLogEntry,
  Hex,
  ReachableHex,
  Terrain,
} from './use-battle-socket'

// По умолчанию модели лежат в public/models/<defId>/model.gltf — путь совпадает
// с ключом каталога юнитов на бэкенде, поэтому обычный юнит требует только новой
// папки. Исключения перечисляются явно: крипы пришли отдельными файлами, и без
// этой таблицы бой с логовом падал на попытке загрузить несуществующий путь.
const MODEL_SOURCES: Record<string, string> = {
  werewolf: '/models/creeps/wolk.glb',
}

export const MODEL_PATH = (defId: string) =>
  MODEL_SOURCES[defId] ?? `/models/${defId}/model.gltf`

const KNOWN_MODELS = [
  'warrior',
  'mage',
  'archer',
  'healer',
  'knight',
  'assassin',
  'werewolf',
]

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

export type AnimKind = keyof typeof CLIP_SYNONYMS

export function findClip(names: string[], kind: AnimKind): string | undefined {
  const wanted = CLIP_SYNONYMS[kind]
  return names.find((n) => wanted.some((w) => n.toLowerCase().includes(w)))
}

/** Все клипы одного смысла: у оборотня, например, четыре разные атаки. */
function clipsOfKind(names: string[], kind: AnimKind): string[] {
  const wanted = CLIP_SYNONYMS[kind]
  return names.filter((n) => wanted.some((w) => n.toLowerCase().includes(w)))
}

/**
 * Проигрыватель анимаций модели, привязанный к игровым событиям.
 *
 * Клипы у моделей разные и неполные: у оборотня есть Walk, Die и четыре атаки,
 * но нет idle, а у юнитов Proto Series нет вообще ничего. Поэтому здесь не
 * жёсткие имена, а смысловые состояния, и недостающие подменяются: покой
 * изображается замедленной ходьбой, а модель без клипов просто молчит.
 */
export function useModelAnimator(
  group: React.RefObject<Group | null>,
  animations: AnimationClip[],
  scene: Object3D,
) {
  const clips = useMemo(() => stripRootMotion(animations, scene), [animations, scene])
  const { actions, names, mixer } = useAnimations(clips, group)
  const current = useRef<string | null>(null)
  // Что включить, когда разовый клип доиграет: атака возвращает в покой, а
  // смерть — никуда, иначе труп бы встал и пошёл.
  const after = useRef<AnimKind | null>(null)

  const play = useCallback(
    (kind: AnimKind, opts?: { once?: boolean; then?: AnimKind | null }) => {
      let pool = clipsOfKind(names, kind)
      let timeScale = 1
      if (pool.length === 0 && kind === 'idle') {
        pool = clipsOfKind(names, 'walk')
        timeScale = 0.35
      }
      if (pool.length === 0) return false

      // Из нескольких атак берём случайную — иначе зверь бьёт одним и тем же
      // движением весь бой.
      const name = pool.length === 1 ? pool[0] : pool[Math.floor(Math.random() * pool.length)]
      const next = actions[name]
      if (!next) return false
      if (current.current === name && !opts?.once) return true

      const prev = current.current ? actions[current.current] : null
      if (prev && prev !== next) prev.fadeOut(0.2)

      next.reset()
      next.timeScale = timeScale
      if (opts?.once) {
        next.setLoop(LoopOnce, 1)
        next.clampWhenFinished = true
        after.current = opts.then ?? null
      } else {
        next.setLoop(LoopRepeat, Infinity)
        next.clampWhenFinished = false
        after.current = null
      }
      next.fadeIn(0.2).play()
      current.current = name
      return true
    },
    [actions, names],
  )

  useEffect(() => {
    if (!mixer) return
    const onFinished = () => {
      const next = after.current
      after.current = null
      if (next) play(next)
    }
    mixer.addEventListener('finished', onFinished)
    return () => mixer.removeEventListener('finished', onFinished)
  }, [mixer, play])

  return play
}

/**
 * Клипы без «корневого движения».
 *
 * Анимации ходьбы обычно двигают персонажа вперёд: у оборотня это делает узел
 * `Bip001 Footsteps`. На карте юнит стоит на конкретной клетке, и такой клип
 * уносит модель прочь — она уезжала за край поля и висела в пустоте. Убираем
 * трек смещения у самого верхнего анимируемого узла: остальные кости (в том
 * числе покачивание таза) продолжают работать.
 *
 * Ищем именно верхний узел, а не имя вроде «root»: у разных экспортёров оно
 * своё, а вот положение в иерархии — признак надёжный.
 */
export function stripRootMotion(clips: AnimationClip[], scene: Object3D): AnimationClip[] {
  const depthOf = (name: string): number => {
    let obj = scene.getObjectByName(name)
    if (!obj) return Number.MAX_SAFE_INTEGER
    let depth = 0
    while (obj.parent) {
      depth++
      obj = obj.parent
    }
    return depth
  }

  return clips.map((clip) => {
    const positionTracks = clip.tracks.filter((t) => t.name.endsWith('.position'))
    if (positionTracks.length === 0) return clip

    let rootTrack = positionTracks[0]
    let rootDepth = depthOf(rootTrack.name.split('.')[0])
    for (const t of positionTracks.slice(1)) {
      const d = depthOf(t.name.split('.')[0])
      if (d < rootDepth) {
        rootTrack = t
        rootDepth = d
      }
    }

    const copy = clip.clone()
    copy.tracks = copy.tracks.filter((t) => t.name !== rootTrack.name)
    return copy
  })
}

/**
 * Куда модель «смотрит» в собственных координатах, в радианах вокруг оси Y.
 *
 * Исходный разворот у моделей из разных источников свой: юниты Proto Series
 * смотрят в одну сторону, оборотень из 3ds Max — в другую, и один общий поворот
 * для них не подобрать. Направление вычисляем по скелету: вектор от пятки к
 * носку — это «вперёд» у любого двуногого рига, и на новых моделях это тоже
 * сработает без правки кода.
 *
 * У моделей без костей возвращаем 0: их разворот задаёт вызывающий код.
 */
export function useModelYaw(scene: Object3D): number {
  return useMemo(() => {
    scene.updateWorldMatrix(true, true)
    const feet: Vector3[] = []
    const toes: Vector3[] = []
    scene.traverse((o) => {
      if (!(o as unknown as { isBone?: boolean }).isBone) return
      const name = o.name.toLowerCase()
      // Footsteps — узел корневого движения, а не стопа: он бы испортил среднее.
      if (name.includes('footstep')) return
      if (name.includes('toe')) toes.push(o.getWorldPosition(new Vector3()))
      else if (name.includes('foot')) feet.push(o.getWorldPosition(new Vector3()))
    })
    if (feet.length === 0 || toes.length === 0) return 0

    const average = (points: Vector3[]) =>
      points.reduce((acc, p) => acc.add(p), new Vector3()).divideScalar(points.length)

    const forward = average(toes).sub(average(feet))
    forward.y = 0
    if (forward.lengthSq() < 1e-8) return 0
    return Math.atan2(forward.x, forward.z)
  }, [scene])
}

/**
 * Копия модели, приведённая к заданной высоте и поставленная на землю.
 *
 * Подбирать scale руками нельзя: модели приходят из разных источников и в
 * разных единицах — оборотень оказался в десятки раз крупнее юнитов Proto
 * Series, и на карте закрывал собой всё поле. Поэтому масштаб считается от
 * реальных габаритов, а не задаётся числом.
 */
export function useNormalizedModel(scene: Object3D, targetHeight: number): Group {
  return useMemo(() => {
    // SkeletonUtils.clone, а не scene.clone: обычное клонирование оставляет у
    // копии SkinnedMesh ссылки на кости оригинала, скиннинг ломается и модель
    // вообще перестаёт рисоваться — именно так пропадал оборотень.
    const clone = SkeletonUtils.clone(scene)
    // Без пересчёта мировых матриц Box3 у только что склонированного объекта
    // возвращает мусор, и модель вытягивается в шип.
    clone.updateWorldMatrix(true, true)

    // У скелетной модели положение вершин задают кости, а не узел меша: его
    // собственная матрица при скиннинге взаимно уничтожается (bindMatrixInverse).
    // Поэтому Box3 по мешу показывает одно, а на экране модель оказывается там,
    // где стоят кости, — у оборотня это 112 единиц от начала координат. Меряем
    // по костям, если они есть.
    const box = new Box3()
    const bones: Object3D[] = []
    clone.traverse((o) => {
      if ((o as unknown as { isBone?: boolean }).isBone) bones.push(o)
    })
    if (bones.length > 0) {
      const p = new Vector3()
      for (const bone of bones) box.expandByPoint(bone.getWorldPosition(p.clone()))
    } else {
      box.setFromObject(clone)
    }

    const size = new Vector3()
    const center = new Vector3()
    box.getSize(size)
    box.getCenter(center)

    const wrapper = new Group()
    const scale = size.y > 0 ? targetHeight / size.y : 1
    // Центрируем по горизонтали и сажаем низ модели ровно на нулевую отметку:
    // у разных моделей начало координат то в центре, то в ступнях.
    //
    // Смещаем, а не присваиваем: у корня модели уже может быть своя позиция
    // (сцены из Sketchfab почти всегда со сдвигом), и присваивание отправило бы
    // модель в точку -P0 вместо начала координат — так оборотни улетали за карту.
    clone.position.sub(new Vector3(center.x, box.min.y, center.z))
    // Скелетные меши отсекаются по устаревшей сфере охвата и пропадают —
    // отключаем отсечение, модели тут заведомо небольшие.
    clone.traverse((o) => {
      const m = o as unknown as { isMesh?: boolean; frustumCulled?: boolean }
      if (m.isMesh) m.frustumCulled = false
    })
    wrapper.add(clone)
    wrapper.scale.setScalar(scale)
    return wrapper
  }, [scene, targetHeight])
}

const HEX_SIZE = 0.62

/**
 * Радиус самой плитки чуть меньше шага сетки — между гексами остаётся зазор,
 * и поле читается как выложенное плиткой, а не как сплошная заливка.
 */
const TILE_RADIUS = HEX_SIZE * 0.93

/** Высота юнита на поле: чуть меньше диаметра гекса, чтобы не загораживать соседей. */
const UNIT_HEIGHT = 0.95

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
        <cylinderGeometry args={[TILE_RADIUS, TILE_RADIUS, style.height, 6]} />
        <meshStandardMaterial
          color={style.color}
          roughness={style.rough}
          metalness={terrain === 'water' ? 0.35 : 0}
        />
      </mesh>

      {reachable && (
        <mesh position={[0, style.height + 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          {/* thetaStart сдвигает вершины на 30°: у cylinderGeometry первая
              вершина идёт по +Z, а у circleGeometry — по +X, и без поправки
              подсветка оказывалась повёрнутой относительно плитки. */}
          <circleGeometry args={[TILE_RADIUS * 0.72, 6, Math.PI / 6]} />
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
  lastLog,
  logSeq,
  onPick,
}: {
  unit: BattleFighter
  active: boolean
  attackable: boolean
  /** Последнее событие боя — по нему юнит понимает, что пора бить. */
  lastLog: BattleLogEntry | null
  /** Номер события: без него две атаки подряд неотличимы друг от друга. */
  logSeq: number
  onPick: (targetId: string) => void
}) {
  const group = useRef<Group>(null)
  const { scene, animations } = useGLTF(MODEL_PATH(unit.defId))
  // Копия обязательна: useGLTF отдаёт один и тот же кэшированный граф на все
  // вызовы с этим путём, и без неё два бойца одного типа делили бы трансформ.
  const model = useNormalizedModel(scene, UNIT_HEIGHT)
  const play = useModelAnimator(group, animations, scene)

  const modelYaw = useModelYaw(scene)
  const alive = unit.currentHp > 0
  const [moving, setMoving] = useState(false)
  const hasDeathClip = useRef(false)

  // Покой при появлении и после того, как юнит остановился.
  useEffect(() => {
    if (alive && !moving) play('idle')
  }, [alive, moving, play])

  useEffect(() => {
    if (alive) return
    // Если клипа смерти нет, падение изображается наклоном в useFrame.
    hasDeathClip.current = play('die', { once: true, then: null })
  }, [alive, play])

  useEffect(() => {
    if (moving && alive) play('walk')
  }, [moving, alive, play])

  useEffect(() => {
    if (!lastLog || !alive) return
    // Бьём только когда это событие про нас и это именно удар, а не переход.
    if (lastLog.attackerId !== unit.instanceId || !lastLog.targetId) return
    play('attack', { once: true, then: 'idle' })
  }, [logSeq, lastLog, unit.instanceId, alive, play])
  const [x, z] = hexToWorld(unit.pos)
  // Сторона A стоит слева и смотрит вправо (+X), сторона B — навстречу.
  // Из нужного направления вычитаем собственный разворот модели, иначе каждая
  // модель смотрела бы туда, куда её развернул автор.
  const facing = (unit.side === 0 ? Math.PI / 2 : -Math.PI / 2) - modelYaw

  useFrame((state, delta) => {
    const g = group.current
    if (!g) return
    // Плавный переезд на новую клетку: сервер присылает конечную позицию, а
    // рывок между гексами читался бы как телепорт.
    const dx = x - g.position.x
    const dz = z - g.position.z
    g.position.x += dx * Math.min(1, delta * 6)
    g.position.z += dz * Math.min(1, delta * 6)

    // Ходьбу включаем по факту смещения, а не по приходу события: сервер
    // присылает конечную клетку, а модель едет к ней ещё несколько кадров.
    const isMoving = Math.abs(dx) + Math.abs(dz) > 0.05
    if (isMoving !== moving) setMoving(isMoving)

    // Модель с клипом смерти падает сама; остальные заваливаем наклоном.
    const targetTilt = alive || hasDeathClip.current ? 0 : -Math.PI / 2
    g.rotation.x += (targetTilt - g.rotation.x) * Math.min(1, delta * 6)

    const bob = active && alive ? Math.sin(state.clock.elapsedTime * 3) * 0.05 : 0
    g.position.y = 0.14 + bob
  })

  return (
    <group ref={group} position={[x, 0.14, z]} rotation={[0, facing, 0]}>
      <primitive object={model} />
      {/* Кликаем по отдельной области, а не по самой модели: у скелетных мешей
          луч проверяется по габаритам позы привязки и в цель не попадает. */}
      <mesh
        position={[0, UNIT_HEIGHT / 2, 0]}
        onClick={(e) => {
          if (!attackable) return
          e.stopPropagation()
          onPick(unit.instanceId)
        }}
      >
        <cylinderGeometry args={[0.4, 0.4, UNIT_HEIGHT, 8]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
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
  log,
  onMove,
  onAttack,
}: {
  field: BattleField | null
  units: BattleFighter[]
  activeUnitId: string | null
  reachable: ReachableHex[]
  attackable: AttackOption[]
  /** Журнал боя целиком: последняя запись запускает анимацию удара. */
  log: BattleLogEntry[]
  onMove: (h: Hex) => void
  onAttack: (opt: AttackOption) => void
}) {
  const lastLog = log.length > 0 ? log[log.length - 1] : null
  const attackableById = useMemo(
    () => new Map(attackable.map((o) => [o.targetId, o])),
    [attackable],
  )

  // Кадрируем по геометрическому центру поля, а не по центральной клетке: из-за
  // сдвига нечётных рядов это разные точки, и поле уезжало вбок.
  const [maxX] = hexToWorld({ col: (field?.width ?? 1) - 1, row: 1 })
  const [, maxZ] = hexToWorld({ col: 0, row: (field?.height ?? 1) - 1 })
  const center: [number, number] = [maxX / 2, maxZ / 2]
  const span = Math.max(maxX, maxZ, 1)

  return (
    <div className="h-80 w-full overflow-hidden rounded-lg border border-primary/25 bg-[#120e18] sm:h-[26rem]">
      <Canvas shadows camera={{ position: [center[0], span * 0.62, center[1] + span * 0.72], fov: 45 }}>
        <Suspense fallback={null}>
          <ambientLight intensity={0.75} />
          <directionalLight position={[6, 12, 6]} intensity={1.5} castShadow />
          {/* Свет задаётся вручную, без drei/Environment: тот подтягивает HDR-карту
              с внешнего CDN, а Pikabu требует, чтобы игра работала при включённом
              блокировщике. При сбое загрузки падал весь канвас целиком. */}
          <hemisphereLight args={['#cfe3ff', '#3b2f22', 0.85]} />

          {field && <Field field={field} reachable={reachable} onPick={onMove} />}

          {units.map((unit) => (
            <UnitModel
              key={unit.instanceId}
              unit={unit}
              active={unit.instanceId === activeUnitId}
              attackable={attackableById.has(unit.instanceId)}
              lastLog={lastLog}
              logSeq={log.length}
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
          minDistance={span * 0.35}
          maxDistance={span * 2}
        />
      </Canvas>
    </div>
  )
}

/** Модель на поворотном круге — для карточки юнита в коллекции. */
function Turntable({ defId }: { defId: string }) {
  const group = useRef<Group>(null)
  const { scene } = useGLTF(MODEL_PATH(defId))
  const model = useNormalizedModel(scene, 1.6)

  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.5
  })

  return (
    <group ref={group} position={[0, -0.8, 0]}>
      <primitive object={model} />
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
          {/* Свет задаётся вручную, без drei/Environment: тот подтягивает HDR-карту
              с внешнего CDN, а Pikabu требует, чтобы игра работала при включённом
              блокировщике. При сбое загрузки падал весь канвас целиком. */}
          <hemisphereLight args={['#cfe3ff', '#3b2f22', 0.85]} />
          <Turntable defId={defId} />
        </Suspense>
      </Canvas>
    </div>
  )
}

// Модели тянутся заранее: бой начинается сразу после матчмейкинга, и ждать
// загрузку уже во время первого хода — значит показать пустое поле.
KNOWN_MODELS.forEach((defId) => useGLTF.preload(MODEL_PATH(defId)))
