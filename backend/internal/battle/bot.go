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

// BotChooseTarget выбирает цель для хода бота: добивает самого слабого по
// текущему HP, а при равенстве берёт первого по порядку — так бой выглядит
// осмысленным, оставаясь детерминированным при равных целях.
func (b *Battle) BotChooseTarget(actorID string) (string, bool) {
	targets := b.AliveTargets(actorID)
	if len(targets) == 0 {
		return "", false
	}
	best := targets[0]
	bestHP := -1
	for _, id := range targets {
		f, ok := b.Fighter(id)
		if !ok {
			continue
		}
		if bestHP < 0 || f.CurrentHP < bestHP {
			best, bestHP = id, f.CurrentHP
		}
	}
	return best, true
}
