// Зеркало backend/internal/units/catalog.go — нужно только для отображения
// названий и статов в UI. Источник истины по статам и списанию золота — бэкенд.

export type Stats = {
  hp: number
  atk: number
  def: number
  spd: number
}

export type UnitDefinition = {
  id: string
  name: string
  base: Stats
  growth: number
}

export const MAX_LEVEL = 20

export const CATALOG: Record<string, UnitDefinition> = {
  warrior: { id: 'warrior', name: 'Воин', base: { hp: 120, atk: 18, def: 12, spd: 8 }, growth: 0.08 },
  mage: { id: 'mage', name: 'Маг', base: { hp: 70, atk: 26, def: 4, spd: 10 }, growth: 0.08 },
  archer: { id: 'archer', name: 'Лучник', base: { hp: 85, atk: 20, def: 6, spd: 14 }, growth: 0.08 },
  healer: { id: 'healer', name: 'Целитель', base: { hp: 90, atk: 10, def: 8, spd: 9 }, growth: 0.08 },
  knight: { id: 'knight', name: 'Рыцарь', base: { hp: 150, atk: 15, def: 18, spd: 6 }, growth: 0.08 },
  assassin: { id: 'assassin', name: 'Убийца', base: { hp: 75, atk: 24, def: 5, spd: 18 }, growth: 0.08 },
}

export function statsAtLevel(defId: string, level: number): Stats {
  const def = CATALOG[defId]
  if (!def) return { hp: 0, atk: 0, def: 0, spd: 0 }
  const mult = 1 + def.growth * (level - 1)
  return {
    hp: Math.floor(def.base.hp * mult),
    atk: Math.floor(def.base.atk * mult),
    def: Math.floor(def.base.def * mult),
    spd: Math.floor(def.base.spd * mult),
  }
}

export function upgradeCost(level: number): number {
  return 50 * level
}
