package battle

import "testing"

func TestDistance_OddROffset(t *testing.T) {
	cases := []struct {
		a, b Hex
		want int
	}{
		{Hex{0, 0}, Hex{0, 0}, 0},
		{Hex{0, 0}, Hex{1, 0}, 1},
		{Hex{3, 4}, Hex{6, 4}, 3},
		{Hex{0, 0}, Hex{0, 2}, 2},   // через ряд по вертикали
		{Hex{0, 0}, Hex{10, 8}, 14}, // угол в угол на поле 11x9
	}
	for _, c := range cases {
		if got := Distance(c.a, c.b); got != c.want {
			t.Errorf("Distance(%v,%v) = %d, ожидали %d", c.a, c.b, got, c.want)
		}
		if got := Distance(c.b, c.a); got != c.want {
			t.Errorf("Distance несимметрична для %v/%v", c.a, c.b)
		}
	}
}

func TestNeighbors_AlwaysAdjacentAndInBounds(t *testing.T) {
	m := NewMap(FieldWidth, FieldHeight, 1)
	for row := 0; row < m.Height; row++ {
		for col := 0; col < m.Width; col++ {
			h := Hex{col, row}
			ns := m.Neighbors(h)
			if len(ns) < 2 || len(ns) > 6 {
				t.Fatalf("у %v оказалось %d соседей", h, len(ns))
			}
			for _, n := range ns {
				if !m.InBounds(n) {
					t.Fatalf("сосед %v клетки %v вне поля", n, h)
				}
				if d := Distance(h, n); d != 1 {
					t.Fatalf("сосед %v клетки %v на расстоянии %d", n, h, d)
				}
			}
		}
	}
}

func TestReachable_RespectsTerrainCostAndObstacles(t *testing.T) {
	m := NewMap(5, 5, 7)
	// Ровное поле — так проверяется именно бюджет хода, а не случайный ландшафт.
	for h := range m.Tiles {
		m.Tiles[h] = TerrainPlain
	}
	from := Hex{2, 2}

	reach := m.Reachable(from, 1, nil)
	if len(reach) != len(m.Neighbors(from)) {
		t.Fatalf("за 1 очко хода ожидали только соседей, получили %d клеток", len(reach))
	}

	// Лес вдвое дороже: в него можно войти за 2, но не за 1.
	forest := m.Neighbors(from)[0]
	m.Tiles[forest] = TerrainForest
	if _, ok := m.Reachable(from, 1, nil)[forest]; ok {
		t.Fatal("в лес нельзя войти за одно очко хода")
	}
	if cost, ok := m.Reachable(from, 2, nil)[forest]; !ok || cost != 2 {
		t.Fatalf("вход в лес должен стоить 2, получено ok=%v cost=%d", ok, cost)
	}

	// Гора непроходима вообще.
	m.Tiles[forest] = TerrainMountain
	if _, ok := m.Reachable(from, 99, nil)[forest]; ok {
		t.Fatal("гора должна быть непроходимой")
	}

	// Занятую клетку тоже не занять.
	busy := m.Neighbors(from)[1]
	if _, ok := m.Reachable(from, 3, map[Hex]bool{busy: true})[busy]; ok {
		t.Fatal("нельзя встать на занятую клетку")
	}
}

func TestNewMap_SpawnColumnsStayPassable(t *testing.T) {
	// Отряды стартуют в крайних колонках: если туда попадёт гора или вода,
	// юнита замурует ещё до первого хода.
	for seed := int64(0); seed < 40; seed++ {
		m := NewMap(FieldWidth, FieldHeight, seed)
		for row := 0; row < m.Height; row++ {
			for _, col := range []int{0, FieldWidth - 1} {
				if tr := m.Terrain(Hex{col, row}); !tr.Passable() {
					t.Fatalf("seed %d: стартовая клетка %v оказалась %q", seed, Hex{col, row}, tr)
				}
			}
		}
	}
}
