import { useCallback, useRef, useState } from 'react'
import { battleWsUrl } from './api'

export type BattleStats = { hp: number; atk: number; def: number; spd: number }

export type Hex = { col: number; row: number }

export type Terrain = 'plain' | 'forest' | 'mountain' | 'water'

export type BattleField = {
  width: number
  height: number
  rows: Terrain[][]
}

/** Клетка, куда юнит может дойти, и цена пути до неё. */
export type ReachableHex = Hex & { cost: number }

/** Цель и самая дешёвая клетка, с которой до неё достаёт — считает сервер. */
export type AttackOption = { targetId: string; from: Hex; cost: number }

export type BattleFighter = {
  instanceId: string
  /** Тип юнита из каталога — по нему выбирается 3D-модель (name локализован). */
  defId: string
  name: string
  side: 0 | 1
  stats: BattleStats
  currentHp: number
  pos: Hex
  moves: number
  range: number
}

export type BattleLogEntry = {
  attackerId: string
  targetId: string
  damage: number
  targetKo: boolean
  /** Заполнено, если юнит сместился — в том числе когда удара не было. */
  movedTo?: Hex
}

type BattlePhase = 'idle' | 'queued' | 'in_progress' | 'finished'

export type BattleState = {
  phase: BattlePhase
  playerA: string | null
  playerB: string | null
  units: BattleFighter[]
  field: BattleField | null
  reachable: ReachableHex[]
  attackable: AttackOption[]
  log: BattleLogEntry[]
  yourTurnUnitId: string | null
  /** Чей ход у соперника — нужен арене, чтобы подсветить активного юнита и на той стороне. */
  opponentUnitId: string | null
  validTargets: string[]
  winner: string | null
  endReason: string | null
  /** Логово, с которым идёт бой, — приходит до battle_start в режиме крипов. */
  creep: { defId: string; name: string; count: number; level: number } | null
  /** Юнит, доставшийся за победу над логовом. */
  recruited: { defId: string; name: string } | null
  error: string | null
}

const initialState: BattleState = {
  phase: 'idle',
  playerA: null,
  playerB: null,
  units: [],
  field: null,
  reachable: [],
  attackable: [],
  log: [],
  yourTurnUnitId: null,
  opponentUnitId: null,
  validTargets: [],
  winner: null,
  endReason: null,
  creep: null,
  recruited: null,
  error: null,
}

/**
 * Управляет одним WebSocket-соединением боя: постановка в очередь, обработка
 * событий сервера (battle_start/your_turn/opponent_turn/battle_update/battle_end)
 * и отправка выбранного действия игрока.
 */
export function useBattleSocket(playerId: string) {
  const [state, setState] = useState<BattleState>(initialState)
  const wsRef = useRef<WebSocket | null>(null)

  const findMatch = useCallback(
    (unitIds: string[], mode?: 'creep') => {
      wsRef.current?.close()
      setState({ ...initialState, phase: 'queued' })

      const ws = new WebSocket(battleWsUrl(playerId))
      wsRef.current = ws

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'queue', unitIds, ...(mode ? { mode } : {}) }))
      }

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case 'queued':
            setState((s) => ({ ...s, phase: 'queued' }))
            break
          // Бой с нейтралами: сервер сообщает состав логова до начала боя.
          case 'creep_encounter':
            setState((s) => ({ ...s, creep: msg.creep }))
            break
          case 'unit_recruited':
            setState((s) => ({
              ...s,
              recruited: { defId: msg.unit.defId, name: msg.unitName },
            }))
            break
          case 'battle_start':
            setState((s) => ({
              ...s,
              phase: 'in_progress',
              playerA: msg.playerA,
              playerB: msg.playerB,
              units: msg.units,
              field: msg.field,
            }))
            break
          case 'your_turn':
            setState((s) => ({
              ...s,
              yourTurnUnitId: msg.unitId,
              opponentUnitId: null,
              validTargets: msg.validTargets,
              reachable: msg.reachable ?? [],
              attackable: msg.attackable ?? [],
            }))
            break
          case 'opponent_turn':
            setState((s) => ({
              ...s,
              yourTurnUnitId: null,
              opponentUnitId: msg.unitId,
              validTargets: [],
              reachable: [],
              attackable: [],
            }))
            break
          case 'battle_update':
            setState((s) => ({
              ...s,
              units: msg.units,
              log: [...s.log, msg.log as BattleLogEntry],
              reachable: [],
              attackable: [],
            }))
            break
          // Юнита заперло местностью и телами — сервер пропустил его ход сам.
          case 'turn_skipped':
            setState((s) => ({
              ...s,
              units: msg.units,
              yourTurnUnitId: null,
              opponentUnitId: null,
              reachable: [],
              attackable: [],
            }))
            break
          case 'battle_end':
            setState((s) => ({
              ...s,
              phase: 'finished',
              winner: msg.winner,
              endReason: msg.reason ?? null,
              yourTurnUnitId: null,
              opponentUnitId: null,
              validTargets: [],
              reachable: [],
              attackable: [],
            }))
            ws.close()
            break
          case 'error':
            setState((s) => ({ ...s, error: msg.message }))
            break
        }
      }

      ws.onerror = () => {
        setState((s) => ({ ...s, error: 'Ошибка соединения с сервером боя' }))
      }
    },
    [playerId],
  )

  /** Ход: пройти в moveTo и/или ударить targetId. Можно только идти или только бить. */
  const act = useCallback((opts: { targetId?: string; moveTo?: Hex }) => {
    wsRef.current?.send(JSON.stringify({ type: 'action', ...opts }))
  }, [])

  const reset = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
    setState(initialState)
  }, [])

  return { state, findMatch, act, reset }
}
