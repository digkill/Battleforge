// Карта приключений: гексовый мир, по которому ходит герой.
//
// Раскладка и математика те же, что у боевого поля на сервере (offset «odd-r»),
// чтобы не держать в голове две системы координат. Мир живёт на клиенте: он
// целиком выводится из seed, поэтому его не нужно ни хранить, ни синхронизировать —
// достаточно запомнить seed и позицию героя.

/** `void` — клетка вне карты: она не рисуется и непроходима. */
export type WorldTerrain = 'grass' | 'forest' | 'mountain' | 'water' | 'road' | 'void'

export type WorldHex = { col: number; row: number }

export type Lair = {
  id: string
  at: WorldHex
  defId: string
  name: string
  /** Разбитое логово исчезает с карты, но seed остаётся прежним. */
  cleared: boolean
}

export type World = {
  width: number
  height: number
  rows: WorldTerrain[][]
  hero: WorldHex
  /** Замок: сюда герой возвращается нанимать войско. */
  castle: WorldHex
  lairs: Lair[]
}

/** Очков передвижения у героя на один день. */
export const MOVES_PER_DAY = 26

/**
 * Карта — большой шестиугольник, собранный из шестиугольников.
 *
 * Хранится она по-прежнему прямоугольником: так проще и рисовать, и считать
 * соседей. Клетки за пределами шестиугольника помечаются `void` — их не видно
 * и в них не войти. При радиусе R в шестиугольник попадает 3R²+3R+1 клетка:
 * при R=10 это 331 против прежних 154, то есть карта стала вдвое больше.
 */
export const WORLD_RADIUS = 10
export const WORLD_WIDTH = WORLD_RADIUS * 2 + 1
export const WORLD_HEIGHT = WORLD_RADIUS * 2 + 1

/** Центральная клетка — от неё отмеряется форма шестиугольника. */
export const WORLD_CENTER: WorldHex = { col: WORLD_RADIUS, row: WORLD_RADIUS }

const IMPASSABLE: WorldTerrain[] = ['mountain', 'water', 'void']

export function isPassable(t: WorldTerrain): boolean {
  return !IMPASSABLE.includes(t)
}

/** Цена входа в клетку: дорога быстрее травы, лес медленнее. */
export function moveCost(t: WorldTerrain): number {
  switch (t) {
    case 'road':
      return 1
    case 'grass':
      return 2
    case 'forest':
      return 4
    default:
      return 0
  }
}

// Свой генератор псевдослучайных чисел, а не Math.random: мир должен
// восстанавливаться из одного только seed, иначе после перезагрузки страницы
// герой окажется посреди другого мира.
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ODD_R_DIRECTIONS = [
  [
    [+1, 0],
    [0, -1],
    [-1, -1],
    [-1, 0],
    [-1, +1],
    [0, +1],
  ],
  [
    [+1, 0],
    [+1, -1],
    [0, -1],
    [-1, 0],
    [0, +1],
    [+1, +1],
  ],
]

export function neighbors(h: WorldHex, width: number, height: number): WorldHex[] {
  const table = ODD_R_DIRECTIONS[h.row & 1]
  const out: WorldHex[] = []
  for (const [dc, dr] of table) {
    const n = { col: h.col + dc, row: h.row + dr }
    if (n.col >= 0 && n.col < width && n.row >= 0 && n.row < height) out.push(n)
  }
  return out
}

function toCube(h: WorldHex) {
  const x = h.col - (h.row - (h.row & 1)) / 2
  const z = h.row
  return [x, -x - z, z]
}

export function hexDistance(a: WorldHex, b: WorldHex): number {
  const [ax, ay, az] = toCube(a)
  const [bx, by, bz] = toCube(b)
  return (Math.abs(ax - bx) + Math.abs(ay - by) + Math.abs(az - bz)) / 2
}

export function hexKey(h: WorldHex): string {
  return `${h.col}:${h.row}`
}

/** Суммарная цена маршрута — сколько очков передвижения он съест. */
export function pathCost(world: World, path: WorldHex[]): number {
  return path.reduce((sum, h) => sum + moveCost(world.rows[h.row][h.col]), 0)
}

/**
 * Все клетки, достижимые за budget очков, и цена пути до каждой — одним обходом.
 *
 * Раньше достижимость считалась перебором: findPath до каждой из полутора сотен
 * клеток, то есть полторы сотни полных обходов карты на каждый пересчёт. Здесь
 * один проход Дейкстры от героя даёт то же самое.
 */
export function reachableFrom(
  world: World,
  from: WorldHex,
  budget: number,
  blocked: Set<string>,
): Map<string, number> {
  const dist = new Map<string, number>([[hexKey(from), 0]])
  const visited = new Set<string>()

  for (;;) {
    let cur: WorldHex | null = null
    let best = Infinity
    for (const [key, d] of dist) {
      if (!visited.has(key) && d < best) {
        best = d
        const [c, r] = key.split(':').map(Number)
        cur = { col: c, row: r }
      }
    }
    if (!cur) break
    visited.add(hexKey(cur))

    for (const n of neighbors(cur, world.width, world.height)) {
      const key = hexKey(n)
      const cost = moveCost(world.rows[n.row][n.col])
      if (cost === 0 || blocked.has(key)) continue
      const nd = best + cost
      if (nd <= budget && nd < (dist.get(key) ?? Infinity)) dist.set(key, nd)
    }
  }

  dist.delete(hexKey(from))
  return dist
}

/** Путь героя до клетки с учётом местности, или null, если пути нет. */
export function findPath(
  world: World,
  from: WorldHex,
  to: WorldHex,
  blocked: Set<string>,
): WorldHex[] | null {
  if (hexKey(from) === hexKey(to)) return []
  const dist = new Map<string, number>([[hexKey(from), 0]])
  const prev = new Map<string, WorldHex>()
  const visited = new Set<string>()

  for (;;) {
    let cur: WorldHex | null = null
    let best = Infinity
    for (const [key, d] of dist) {
      if (!visited.has(key) && d < best) {
        best = d
        const [c, r] = key.split(':').map(Number)
        cur = { col: c, row: r }
      }
    }
    if (!cur) break
    visited.add(hexKey(cur))
    if (hexKey(cur) === hexKey(to)) break

    for (const n of neighbors(cur, world.width, world.height)) {
      const key = hexKey(n)
      const cost = moveCost(world.rows[n.row][n.col])
      // В занятую клетку не входим, но саму цель пропускаем: логово — это то,
      // ради чего герой туда и идёт.
      if (cost === 0 || (blocked.has(key) && key !== hexKey(to))) continue
      const nd = best + cost
      if (nd < (dist.get(key) ?? Infinity)) {
        dist.set(key, nd)
        prev.set(key, cur)
      }
    }
  }

  if (!dist.has(hexKey(to))) return null
  const path: WorldHex[] = []
  let cur = to
  while (hexKey(cur) !== hexKey(from)) {
    path.unshift(cur)
    const p = prev.get(hexKey(cur))
    if (!p) return null
    cur = p
  }
  return path
}

/** Клетка внутри большого шестиугольника? */
export function inWorld(h: WorldHex): boolean {
  return hexDistance(h, WORLD_CENTER) <= WORLD_RADIUS
}

/** Собирает мир целиком из seed: форму, ландшафт, дорогу, замок и логова. */
export function generateWorld(seed: number): World {
  const rnd = mulberry32(seed)
  const width = WORLD_WIDTH
  const height = WORLD_HEIGHT

  // Прямоугольник заполняется целиком, но всё за границей шестиугольника
  // сразу помечается пустотой — дальше эти клетки просто не участвуют.
  const rows: WorldTerrain[][] = Array.from({ length: height }, (_, row) =>
    Array.from({ length: width }, (_, col) =>
      inWorld({ col, row }) ? ('grass' as WorldTerrain) : ('void' as WorldTerrain),
    ),
  )

  const blob = (t: WorldTerrain, count: number, size: number) => {
    for (let i = 0; i < count; i++) {
      let frontier: WorldHex[] = [
        { col: Math.floor(rnd() * width), row: Math.floor(rnd() * height) },
      ]
      let left = size
      while (frontier.length && left > 0) {
        const h = frontier.shift()!
        if (h.col < 0 || h.col >= width || h.row < 0 || h.row >= height) continue
        if (rows[h.row][h.col] !== 'grass') continue
        rows[h.row][h.col] = t
        left--
        for (const n of neighbors(h, width, height)) if (rnd() < 0.55) frontier.push(n)
      }
    }
  }

  // Пятен вдвое больше прежнего: площадь выросла, и на старом количестве
  // карта выглядела бы пустой равниной.
  blob('forest', 10, 14)
  blob('mountain', 6, 9)
  blob('water', 6, 10)

  // Дорога через всю карту по центральному ряду — он самый длинный и проходит
  // через середину шестиугольника, давая герою читаемый маршрут.
  let roadRow = WORLD_RADIUS
  for (let col = 0; col < width; col++) {
    const put = (r: number) => {
      if (r >= 0 && r < height && rows[r][col] !== 'void') rows[r][col] = 'road'
    }
    put(roadRow)
    if (rnd() < 0.35) {
      roadRow = Math.max(1, Math.min(height - 2, roadRow + (rnd() < 0.5 ? -1 : 1)))
      put(roadRow)
    }
  }

  // Замок ставим на левый край шестиугольника, героя — на соседнюю клетку:
  // на одной клетке башня целиком скрывала фигурку.
  let castleCol = 0
  while (castleCol < width && rows[WORLD_RADIUS][castleCol] === 'void') castleCol++
  const castle: WorldHex = { col: castleCol, row: WORLD_RADIUS }
  const hero: WorldHex = { col: Math.min(castleCol + 1, width - 1), row: WORLD_RADIUS }
  rows[castle.row][castle.col] = 'road'
  rows[hero.row][hero.col] = 'road'

  // Логов тоже вдвое больше — иначе на большой карте до них слишком далеко идти.
  const lairs: Lair[] = []
  let guard = 0
  while (lairs.length < 8 && guard < 2000) {
    guard++
    const at = { col: Math.floor(rnd() * width), row: Math.floor(rnd() * height) }
    if (!isPassable(rows[at.row][at.col])) continue
    if (hexDistance(at, hero) < 5) continue
    if (lairs.some((l) => hexKey(l.at) === hexKey(at))) continue
    lairs.push({
      id: `lair-${lairs.length + 1}`,
      at,
      defId: 'werewolf',
      name: 'Логово оборотней',
      cleared: false,
    })
  }

  return { width, height, rows, hero, castle, lairs }
}
