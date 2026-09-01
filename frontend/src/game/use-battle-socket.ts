import { useCallback, useRef, useState } from 'react'
import { battleWsUrl } from './api'

export type BattleStats = { hp: number; atk: number; def: number; spd: number }

export type BattleFighter = {
  instanceId: string
  name: string
  side: 0 | 1
  stats: BattleStats
  currentHp: number
}

export type BattleLogEntry = {
  attackerId: string
  targetId: string
  damage: number
  targetKo: boolean
}

type BattlePhase = 'idle' | 'queued' | 'in_progress' | 'finished'

export type BattleState = {
  phase: BattlePhase
  playerA: string | null
  playerB: string | null
  units: BattleFighter[]
  log: BattleLogEntry[]
  yourTurnUnitId: string | null
  validTargets: string[]
  winner: string | null
  endReason: string | null
  error: string | null
}

const initialState: BattleState = {
  phase: 'idle',
  playerA: null,
  playerB: null,
  units: [],
  log: [],
  yourTurnUnitId: null,
  validTargets: [],
  winner: null,
  endReason: null,
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
    (unitIds: string[]) => {
      wsRef.current?.close()
      setState({ ...initialState, phase: 'queued' })

      const ws = new WebSocket(battleWsUrl(playerId))
      wsRef.current = ws

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'queue', unitIds }))
      }

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case 'queued':
            setState((s) => ({ ...s, phase: 'queued' }))
            break
          case 'battle_start':
            setState((s) => ({
              ...s,
              phase: 'in_progress',
              playerA: msg.playerA,
              playerB: msg.playerB,
              units: msg.units,
            }))
            break
          case 'your_turn':
            setState((s) => ({ ...s, yourTurnUnitId: msg.unitId, validTargets: msg.validTargets }))
            break
          case 'opponent_turn':
            setState((s) => ({ ...s, yourTurnUnitId: null, validTargets: [] }))
            break
          case 'battle_update':
            setState((s) => ({
              ...s,
              units: msg.units,
              log: [...s.log, msg.log as BattleLogEntry],
            }))
            break
          case 'battle_end':
            setState((s) => ({
              ...s,
              phase: 'finished',
              winner: msg.winner,
              endReason: msg.reason ?? null,
              yourTurnUnitId: null,
              validTargets: [],
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

  const act = useCallback((targetId: string) => {
    wsRef.current?.send(JSON.stringify({ type: 'action', targetId }))
  }, [])

  const reset = useCallback(() => {
    wsRef.current?.close()
    wsRef.current = null
    setState(initialState)
  }, [])

  return { state, findMatch, act, reset }
}
