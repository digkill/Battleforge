package battle

import "testing"

func TestMatchmaker_PairsTwoDifferentPlayers(t *testing.T) {
	mm := NewMatchmaker()

	w1 := mm.Enqueue("alice", squad(t, "warrior"))
	select {
	case <-w1.Matched:
		t.Fatal("alice should still be waiting alone")
	default:
	}

	w2 := mm.Enqueue("bob", squad(t, "mage"))

	m1 := <-w1.Matched
	m2 := <-w2.Matched
	if m1 != m2 {
		t.Fatal("both players should receive the same Match")
	}
	if m1.PlayerA != "alice" || m1.PlayerB != "bob" {
		t.Fatalf("unexpected match players: %+v", m1)
	}
}

func TestMatchmaker_SamePlayerDoesNotMatchSelf(t *testing.T) {
	mm := NewMatchmaker()

	mm.Enqueue("alice", squad(t, "warrior"))
	w2 := mm.Enqueue("alice", squad(t, "warrior"))

	select {
	case <-w2.Matched:
		t.Fatal("player should not be matched against themselves")
	default:
	}
}

func TestMatchmaker_CancelRemovesFromQueue(t *testing.T) {
	mm := NewMatchmaker()

	mm.Enqueue("alice", squad(t, "warrior"))
	mm.Cancel("alice")

	w2 := mm.Enqueue("bob", squad(t, "mage"))
	select {
	case <-w2.Matched:
		t.Fatal("bob should be waiting alone after alice cancelled")
	default:
	}
}
