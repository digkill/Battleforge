// Карта приключений: гексовый мир, по которому ходит герой.
//
// Раскладка и математика те же, что у боевого поля на сервере (offset «odd-r»),
// чтобы не держать в голове две системы координат. Мир живёт на клиенте: он
// целиком выводится из seed, поэтому его не нужно ни хранить, ни синхронизировать —
// достаточно запомнить seed и позицию героя.

export type WorldTerrain = 'grass' | 'forest' | 'mountain' | 'water' | 'road'

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
  lairs: Lair[]
}

export const WORLD_WIDTH = 14
export const WORLD_HEIGHT = 11

const IMPASSABLE: WorldTerrain[] = ['mountain', 'water']

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

/** Собирает мир целиком из seed: ландшафт, дорогу, логова и стартовую клетку героя. */
export function generateWorld(seed: number): World {
  const rnd = mulberry32(seed)
  const width = WORLD_WIDTH
  const height = WORLD_HEIGHT
  const rows: WorldTerrain[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 'grass' as WorldTerrain),
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

  blob('forest', 5, 12)
  blob('mountain', 3, 8)
  blob('water', 3, 9)

  // Дорога поперёк карты: даёт герою быстрый маршрут и читаемый ориентир,
  // иначе поле выглядит однородным пятном.
  let roadRow = Math.floor(height / 2)
  for (let col = 0; col < width; col++) {
    rows[roadRow][col] = 'road'
    if (rnd() < 0.35) {
      roadRow = Math.max(1, Math.min(height - 2, roadRow + (rnd() < 0.5 ? -1 : 1)))
      rows[roadRow][col] = 'road'
    }
  }

  const hero: WorldHex = { col: 0, row: Math.floor(height / 2) }
  rows[hero.row][hero.col] = 'road'

  // Логова расставляются подальше от героя, чтобы первый шаг не оказался боем.
  const lairs: Lair[] = []
  let guard = 0
  while (lairs.length < 4 && guard < 500) {
    guard++
    const at = { col: Math.floor(rnd() * width), row: Math.floor(rnd() * height) }
    if (!isPassable(rows[at.row][at.col])) continue
    if (hexDistance(at, hero) < 4) continue
    if (lairs.some((l) => hexKey(l.at) === hexKey(at))) continue
    lairs.push({
      id: `lair-${lairs.length + 1}`,
      at,
      defId: 'werewolf',
      name: 'Логово оборотней',
      cleared: false,
    })
  }

  return { width, height, rows, hero, lairs }
}
