package battle

import (
	"testing"

	"battleforge/backend/internal/units"
)

func squad(t *testing.T, defIDs ...string) []units.Instance {
	t.Helper()
	out := make([]units.Instance, len(defIDs))
	for i, id := range defIDs {
		out[i] = units.Instance{InstanceID: id, DefID: id, Level: 1}
	}
	return out
}

func TestNew_EmptySquadRejected(t *testing.T) {
	_, err := New(nil, squad(t, "warrior"))
	if err != ErrEmptySquad {
		t.Fatalf("expected ErrEmptySquad, got %v", err)
	}
}

func TestNew_UnknownUnitRejected(t *testing.T) {
	_, err := New(squad(t, "not-a-real-unit"), squad(t, "warrior"))
	if err == nil {
		t.Fatal("expected an error for unknown unit type")
	}
}

func TestTurnOrder_FollowsSpeedDescending(t *testing.T) {
	// assassin (SPD 18) должен ходить раньше knight (SPD 6).
	b, err := New(squad(t, "knight"), squad(t, "assassin"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	first, ok := b.CurrentTurn()
	if !ok || first != "assassin" {
		t.Fatalf("expected assassin to go first, got %q", first)
	}
}

func TestAct_WrongActorRejected(t *testing.T) {
	b, err := New(squad(t, "knight"), squad(t, "assassin"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// первый ход — assassin, а не knight
	_, err = b.Act("knight", "assassin")
	if err != ErrNotUnitsTurn {
		t.Fatalf("expected ErrNotUnitsTurn, got %v", err)
	}
}

func TestAct_InvalidTargetRejected(t *testing.T) {
	b, err := New(squad(t, "warrior"), squad(t, "mage"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	current, _ := b.CurrentTurn()
	// цель на своей же стороне — недопустимо
	_, err = b.Act(current, current)
	if err != ErrInvalidTarget {
		t.Fatalf("expected ErrInvalidTarget, got %v", err)
	}
}

func TestAct_DamageAppliedAndMinimumOne(t *testing.T) {
	// knight (DEF 18) против warrior (ATK 18): 18 - 18/2 = 9
	b, err := New(squad(t, "warrior"), squad(t, "knight"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	current, _ := b.CurrentTurn() // warrior ходит первым (SPD 8 > 6)
	if current != "warrior" {
		t.Fatalf("expected warrior to go first, got %q", current)
	}
	entry, err := b.Act("warrior", "knight")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if entry.Damage != 9 {
		t.Fatalf("expected damage 9, got %d", entry.Damage)
	}
	knight, _ := b.Fighter("knight")
	if knight.CurrentHP != knight.Stats.HP-9 {
		t.Fatalf("knight HP not reduced correctly: %d", knight.CurrentHP)
	}
}

func TestBattle_ResolvesToWinnerDeterministically(t *testing.T) {
	b, err := New(squad(t, "warrior"), squad(t, "mage"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	guard := 0
	for b.Winner() == nil {
		guard++
		if guard > 1000 {
			t.Fatal("battle did not resolve — possible infinite loop")
		}
		actorID, ok := b.CurrentTurn()
		if !ok {
			t.Fatal("no current turn but battle not over")
		}
		targets := b.AliveTargets(actorID)
		if len(targets) == 0 {
			t.Fatal("actor has no targets but battle not over")
		}
		if _, err := b.Act(actorID, targets[0]); err != nil {
			t.Fatalf("unexpected error acting: %v", err)
		}
	}

	winner := b.Winner()
	if winner == nil {
		t.Fatal("expected a winner")
	}
	if *winner != SideA {
		t.Fatalf("expected warrior (higher ATK, SideA) to win, got side %v", *winner)
	}

	// после победы дальнейшие ходы запрещены
	if _, err := b.Act("warrior", "mage"); err != ErrBattleOver {
		t.Fatalf("expected ErrBattleOver after battle ended, got %v", err)
	}
}
