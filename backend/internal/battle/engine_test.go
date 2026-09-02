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
	_, err = b.Act("knight", nil, "assassin")
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
	_, err = b.Act(current, nil, current)
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
	// Отряды стартуют по разным краям поля, а warrior — рукопашник с дальностью 1.
	// Ставим бойцов вплотную, чтобы проверять именно формулу урона, а не ходьбу.
	b.fighters["warrior"].Pos = Hex{Col: 5, Row: 4}
	b.fighters["knight"].Pos = Hex{Col: 6, Row: 4}
	entry, err := b.Act("warrior", nil, "knight")
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
		moveTo, targetID, ok := b.BotChooseAction(actorID)
		if !ok {
			t.Fatal("actor has no available action but battle not over")
		}
		if _, err := b.Act(actorID, moveTo, targetID); err != nil {
			t.Fatalf("unexpected error acting: %v", err)
		}
	}

	winner := b.Winner()
	if winner == nil {
		t.Fatal("expected a winner")
	}
	// Кто именно победит, теперь зависит от местности и дистанции: маг с
	// дальностью 4 расстреливает рукопашника, пока тот идёт через поле.
	// Тест следит за тем, что бой сходится, а не за конкретной стороной.

	// после победы дальнейшие ходы запрещены
	if _, err := b.Act("warrior", nil, "mage"); err != ErrBattleOver {
		t.Fatalf("expected ErrBattleOver after battle ended, got %v", err)
	}
}

// TestAttackRange_RangedStrikesFromAfarMeleeMustCloseIn — суть перехода на поле:
// дальность решает, кто может ударить, не сходя с места. Стрелок бьёт через
// три клетки, рукопашник с той же дистанции обязан сначала подойти.
func TestAttackRange_RangedStrikesFromAfarMeleeMustCloseIn(t *testing.T) {
	b, err := New(squad(t, "archer"), squad(t, "knight"))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	b.fighters["archer"].Pos = Hex{Col: 3, Row: 4}
	b.fighters["knight"].Pos = Hex{Col: 6, Row: 4}
	if d := Distance(Hex{Col: 3, Row: 4}, Hex{Col: 6, Row: 4}); d != 3 {
		t.Fatalf("подготовка теста неверна: ожидали дистанцию 3, получили %d", d)
	}

	current, _ := b.CurrentTurn() // archer быстрее (SPD 14 против 6)
	if current != "archer" {
		t.Fatalf("ожидали ход стрелка, получили %q", current)
	}
	if _, err := b.Act("archer", nil, "knight"); err != nil {
		t.Fatalf("стрелок (дальность 4) должен доставать через 3 клетки: %v", err)
	}

	current, _ = b.CurrentTurn()
	if current != "knight" {
		t.Fatalf("ожидали ход рыцаря, получили %q", current)
	}
	if _, err := b.Act("knight", nil, "archer"); err != ErrOutOfRange {
		t.Fatalf("рукопашник не должен бить через 3 клетки, получено: %v", err)
	}
}

// TestBattle_3v3ResolvesWithoutStallingOnDeadUnit — регрессия: очередь ходов
// строится один раз на раунд, и юнит может погибнуть до своего хода внутри того
// же раунда. Раньше CurrentTurn() возвращал такого мертвеца, Act() отвечал
// ErrUnitNotFound не сдвигая turnIdx, и бой зависал навсегда. В отряде из трёх
// юнитов (боевой формат игры) это происходило штатно.
func TestBattle_3v3ResolvesWithoutStallingOnDeadUnit(t *testing.T) {
	b, err := New(
		squad(t, "assassin", "mage", "archer"),
		squad(t, "healer", "knight", "warrior"),
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	guard := 0
	for b.Winner() == nil {
		guard++
		if guard > 1000 {
			t.Fatal("бой не сошёлся — очередь ходов зациклилась")
		}
		actorID, ok := b.CurrentTurn()
		if !ok {
			t.Fatal("нет текущего хода, но бой не окончен")
		}
		if f, _ := b.Fighter(actorID); !f.Alive() {
			t.Fatalf("CurrentTurn вернул мёртвого юнита %q (HP=%d)", actorID, f.CurrentHP)
		}
		moveTo, targetID, ok := b.BotChooseAction(actorID)
		if !ok {
			t.Fatalf("у %q нет доступного действия, но бой не окончен", actorID)
		}
		if _, err := b.Act(actorID, moveTo, targetID); err != nil {
			t.Fatalf("Act(%q) вернул ошибку: %v", actorID, err)
		}
	}
}
