package battle

import (
	"fmt"

	"battleforge/backend/internal/units"
)

// BotPlayerID — идентификатор виртуального соперника. Префикс с двоеточием не
// может встретиться в реальном playerID из Pikabu SDK, поэтому спутать нельзя.
const BotPlayerID = "bot:trainer"

// IsBot сообщает, что за этим playerID нет живого игрока и соединения.
func IsBot(playerID string) bool { return playerID == BotPlayerID }

// NewBotSquad собирает отряд виртуальному сопернику зеркально отряду игрока: те же типы
// юнитов тех же уровней. Зеркало выбрано намеренно — оно не требует ручной
// балансировки и не даёт фармить бота заведомо слабым составом.
//
// InstanceID обязательно свой: Battle держит бойцов в карте по instanceID, и
// совпадение идентификаторов слило бы юнита игрока с юнитом бота в одного.
func NewBotSquad(playerSquad []units.Instance) []units.Instance {
	squad := make([]units.Instance, 0, len(playerSquad))
	for i, u := range playerSquad {
		squad = append(squad, units.Instance{
			InstanceID: fmt.Sprintf("bot-%d", i+1),
			DefID:      u.DefID,
			Level:      u.Level,
		})
	}
	return squad
}

// BotChooseAction решает, что бот делает в свой ход: куда встать и кого бить.
//
// Порядок намеренно простой и предсказуемый:
//  1. бьёт с места, если кто-то уже в досягаемости;
//  2. иначе ищет клетку, с которой достанет до цели, и бьёт оттуда;
//  3. иначе просто сокращает дистанцию до ближайшего врага.
//
// Из подходящих целей всегда выбирается самая слабая по текущему HP: так бой
// выглядит осмысленным, а при равных целях остаётся детерминированным.
func (b *Battle) BotChooseAction(actorID string) (moveTo *Hex, targetID string, ok bool) {
	actor, exists := b.Fighter(actorID)
	if !exists || !actor.Alive() {
		return nil, "", false
	}
	enemies := b.AliveTargets(actorID)
	if len(enemies) == 0 {
		return nil, "", false
	}

	// 1. Удар с места.
	if id, found := b.weakestReachableTarget(actorID, actor.Pos, enemies); found {
		return nil, id, true
	}

	// 2. Подойти и ударить. Из всех подходящих клеток берём самую дешёвую —
	// иначе бот делал бы лишние круги вместо прямого сближения.
	reachable := b.ReachableFor(actorID)
	bestCost := -1
	var bestHex Hex
	var bestTarget string
	for hex, cost := range reachable {
		id, found := b.weakestReachableTarget(actorID, hex, enemies)
		if !found {
			continue
		}
		if bestCost < 0 || cost < bestCost {
			bestCost, bestHex, bestTarget = cost, hex, id
		}
	}
	if bestCost >= 0 {
		h := bestHex
		return &h, bestTarget, true
	}

	// 3. Никого не достать — идём на сближение.
	bestDist := -1
	for hex := range reachable {
		d := b.minDistanceToAny(hex, enemies)
		if bestDist < 0 || d < bestDist {
			bestDist, bestHex = d, hex
		}
	}
	if bestDist < 0 {
		return nil, "", false // заперт: пропускаем ход
	}
	h := bestHex
	return &h, "", true
}

// weakestReachableTarget — самая слабая по HP цель, до которой юнит достаёт из клетки from.
func (b *Battle) weakestReachableTarget(actorID string, from Hex, enemies []string) (string, bool) {
	best, bestHP := "", -1
	for _, id := range enemies {
		if !b.InAttackRange(actorID, id, from) {
			continue
		}
		f, ok := b.Fighter(id)
		if !ok {
			continue
		}
		if bestHP < 0 || f.CurrentHP < bestHP {
			best, bestHP = id, f.CurrentHP
		}
	}
	return best, bestHP >= 0
}

func (b *Battle) minDistanceToAny(from Hex, enemies []string) int {
	best := -1
	for _, id := range enemies {
		f, ok := b.Fighter(id)
		if !ok {
			continue
		}
		d := Distance(from, f.Pos)
		if best < 0 || d < best {
			best = d
		}
	}
	return best
}
