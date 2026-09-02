package battle

import (
	"math/rand"
	"testing"

	"battleforge/backend/internal/units"
)

func playerSquad(levels ...int) []units.Instance {
	defs := []string{"warrior", "mage", "archer"}
	out := make([]units.Instance, 0, len(levels))
	for i, lvl := range levels {
		out = append(out, units.Instance{
			InstanceID: string(rune('a' + i)),
			DefID:      defs[i%len(defs)],
			Level:      lvl,
		})
	}
	return out
}

// Логово должно быть по зубам: крип сильнее обычного юнита в лоб, поэтому
// численный перевес остаётся за игроком, иначе вербовать их было бы нечем.
func TestNewCreepStack_PlayerKeepsNumbersAdvantage(t *testing.T) {
	r := rand.New(rand.NewSource(1))
	stack, squad, err := NewCreepStack("werewolf", playerSquad(5, 7, 9), r)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if stack.Count != 2 {
		t.Fatalf("против трёх юнитов ожидали 2 крипа, получили %d", stack.Count)
	}
	if len(squad) != 2 {
		t.Fatalf("в отряде логова %d юнитов, ожидали 2", len(squad))
	}
	if stack.Level != 7 { // (5+7+9)/3
		t.Fatalf("уровень логова %d, ожидали средний по отряду 7", stack.Level)
	}
	for _, u := range squad {
		if u.DefID != "werewolf" || u.Level != 7 {
			t.Fatalf("неверный юнит логова: %+v", u)
		}
	}
}

// Одиночный отряд не должен оставаться без противника вовсе.
func TestNewCreepStack_SingleUnitSquadStillGetsOneCreep(t *testing.T) {
	r := rand.New(rand.NewSource(2))
	stack, squad, err := NewCreepStack("werewolf", playerSquad(1), r)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if stack.Count != 1 || len(squad) != 1 {
		t.Fatalf("ожидали одного крипа, получили count=%d len=%d", stack.Count, len(squad))
	}
}

func TestNewCreepStack_UnknownTypeRejected(t *testing.T) {
	r := rand.New(rand.NewSource(3))
	if _, _, err := NewCreepStack("not-a-creep", playerSquad(1, 1), r); err == nil {
		t.Fatal("ожидали ошибку для неизвестного типа крипа")
	}
}

// InstanceID логова не должен пересекаться с юнитами игрока: бой держит бойцов
// в карте по этому ключу, и совпадение слило бы двоих в одного.
func TestNewCreepStack_InstanceIDsDoNotClashWithPlayer(t *testing.T) {
	r := rand.New(rand.NewSource(4))
	player := playerSquad(3, 3, 3)
	_, squad, err := NewCreepStack("werewolf", player, r)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	seen := map[string]bool{}
	for _, u := range player {
		seen[u.InstanceID] = true
	}
	for _, u := range squad {
		if seen[u.InstanceID] {
			t.Fatalf("instanceID %q совпал с юнитом игрока", u.InstanceID)
		}
	}
}
