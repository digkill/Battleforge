package battle

import (
	"fmt"
	"math/rand"

	"battleforge/backend/internal/units"
)

// CreepPlayerID — «владелец» нейтрального отряда. Ходит за него тот же
// серверный ИИ, что и за виртуального соперника.
const CreepPlayerID = "creep:neutral"

func IsCreep(playerID string) bool { return playerID == CreepPlayerID }

// IsServerControlled — за эту сторону ходит сервер, живого соединения нет.
func IsServerControlled(playerID string) bool {
	return IsBot(playerID) || IsCreep(playerID)
}

// CreepStack — нейтральный отряд, который можно встретить и разбить.
type CreepStack struct {
	DefID string `json:"defId"`
	Name  string `json:"name"`
	Count int    `json:"count"`
	Level int    `json:"level"`
}

// NewCreepStack собирает логово нейтралов под силу отряда игрока: уровень по
// среднему уровню отряда, голов на одну меньше, чем у игрока.
//
// Численный перевес игроку нужен потому, что крип сильнее обычного юнита в
// лоб: оборотень бьёт больнее и ходит быстрее любого из стартовой тройки.
// При равном числе логово выигрывало почти всегда, и смысл ходить за крипами
// пропадал — победа над ними и есть способ их завербовать.
func NewCreepStack(defID string, playerSquad []units.Instance, r *rand.Rand) (CreepStack, []units.Instance, error) {
	def, ok := units.Catalog[defID]
	if !ok {
		return CreepStack{}, nil, fmt.Errorf("battle: неизвестный тип крипа %q", defID)
	}

	level := 1
	if len(playerSquad) > 0 {
		sum := 0
		for _, u := range playerSquad {
			sum += u.Level
		}
		level = sum / len(playerSquad)
		if level < 1 {
			level = 1
		}
	}

	count := len(playerSquad) - 1
	if count < 1 {
		count = 1
	}

	squad := make([]units.Instance, 0, count)
	for i := 0; i < count; i++ {
		squad = append(squad, units.Instance{
			// Свой префикс: Battle держит бойцов в карте по instanceID, и
			// совпадение с юнитом игрока слило бы двоих в одного.
			InstanceID: fmt.Sprintf("creep-%d", i+1),
			DefID:      defID,
			Level:      level,
		})
	}
	return CreepStack{DefID: defID, Name: def.Name, Count: count, Level: level}, squad, nil
}

// RandomCreepDefID выбирает, кто именно встретится.
func RandomCreepDefID(r *rand.Rand) string {
	ids := units.CreepDefIDs
	if len(ids) == 0 {
		return ""
	}
	return ids[r.Intn(len(ids))]
}
