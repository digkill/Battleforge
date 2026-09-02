// Гексагональное поле боя с ландшафтом.
//
// Координаты — offset «odd-r»: ряды сдвинуты вправо на нечётных строках, как
// в «Героях». Хранить и рисовать такую сетку удобнее всего прямоугольником
// (Col, Row), а вот расстояние в offset-координатах не считается — для этого
// есть перевод в кубические, где оно вырождается в манхэттенское.
package battle

import "math/rand"

type Hex struct {
	Col int `json:"col"`
	Row int `json:"row"`
}

type Terrain string

const (
	TerrainPlain    Terrain = "plain"
	TerrainForest   Terrain = "forest"
	TerrainMountain Terrain = "mountain"
	TerrainWater    Terrain = "water"
)

// MoveCost — во сколько очков хода обходится вход в клетку. Ноль означает,
// что клетка непроходима: горы обходят, вброд никто не идёт.
func (t Terrain) MoveCost() int {
	switch t {
	case TerrainPlain:
		return 1
	case TerrainForest:
		return 2
	default:
		return 0
	}
}

func (t Terrain) Passable() bool { return t.MoveCost() > 0 }

// Map — прямоугольное поле Width×Height с ландшафтом в каждой клетке.
type Map struct {
	Width  int             `json:"width"`
	Height int             `json:"height"`
	Tiles  map[Hex]Terrain `json:"-"`
	Rows   [][]Terrain     `json:"rows"` // то же самое, но в виде, удобном клиенту
}

func (m *Map) Terrain(h Hex) Terrain {
	t, ok := m.Tiles[h]
	if !ok {
		return TerrainMountain // за краем поля ходить некуда
	}
	return t
}

func (m *Map) InBounds(h Hex) bool {
	return h.Col >= 0 && h.Col < m.Width && h.Row >= 0 && h.Row < m.Height
}

// odd-r: на нечётных рядах соседи смещены вправо, поэтому таблица своя для
// каждой чётности. Порядок направлений роли не играет, важна полнота.
var hexDirections = [2][6][2]int{
	{{+1, 0}, {0, -1}, {-1, -1}, {-1, 0}, {-1, +1}, {0, +1}}, // чётный ряд
	{{+1, 0}, {+1, -1}, {0, -1}, {-1, 0}, {0, +1}, {+1, +1}}, // нечётный ряд
}

func (m *Map) Neighbors(h Hex) []Hex {
	parity := h.Row & 1
	out := make([]Hex, 0, 6)
	for _, d := range hexDirections[parity] {
		n := Hex{Col: h.Col + d[0], Row: h.Row + d[1]}
		if m.InBounds(n) {
			out = append(out, n)
		}
	}
	return out
}

// toCube переводит offset-координаты в кубические — только в них расстояние
// между гексами считается напрямую.
func toCube(h Hex) (x, y, z int) {
	x = h.Col - (h.Row-(h.Row&1))/2
	z = h.Row
	y = -x - z
	return
}

// Distance — число шагов между гексами по прямой, без учёта препятствий.
func Distance(a, b Hex) int {
	ax, ay, az := toCube(a)
	bx, by, bz := toCube(b)
	d := abs(ax-bx) + abs(ay-by) + abs(az-bz)
	return d / 2
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

// Reachable — клетки, куда юнит дойдёт за budget очков хода, и цена пути до
// каждой. Обычный поиск в ширину не годится: лес стоит дороже равнины, поэтому
// идём Дейкстрой по возрастанию стоимости.
//
// occupied — занятые клетки: сквозь чужие спины не проходят и на них не встают.
func (m *Map) Reachable(from Hex, budget int, occupied map[Hex]bool) map[Hex]int {
	dist := map[Hex]int{from: 0}
	// Поле маленькое (сотня клеток), поэтому вместо кучи хватает поиска
	// минимума перебором — кода меньше, а разница в скорости незаметна.
	visited := map[Hex]bool{}
	for {
		var cur Hex
		best := -1
		for h, d := range dist {
			if !visited[h] && (best < 0 || d < best) {
				cur, best = h, d
			}
		}
		if best < 0 {
			break
		}
		visited[cur] = true
		for _, n := range m.Neighbors(cur) {
			if occupied[n] {
				continue
			}
			cost := m.Terrain(n).MoveCost()
			if cost == 0 {
				continue
			}
			nd := best + cost
			if nd > budget {
				continue
			}
			if old, ok := dist[n]; !ok || nd < old {
				dist[n] = nd
			}
		}
	}
	delete(dist, from)
	return dist
}

// NewMap раскладывает ландшафт: равнина по умолчанию, поверх неё несколько
// пятен леса, гор и воды. Стартовые колонки обоих отрядов остаются равниной,
// иначе отряд можно замуровать ещё до первого хода.
func NewMap(width, height int, seed int64) *Map {
	r := rand.New(rand.NewSource(seed))
	m := &Map{Width: width, Height: height, Tiles: make(map[Hex]Terrain, width*height)}
	for row := 0; row < height; row++ {
		for col := 0; col < width; col++ {
			m.Tiles[Hex{col, row}] = TerrainPlain
		}
	}

	blob := func(t Terrain, count, size int) {
		for i := 0; i < count; i++ {
			center := Hex{Col: r.Intn(width), Row: r.Intn(height)}
			frontier := []Hex{center}
			for len(frontier) > 0 && size > 0 {
				h := frontier[0]
				frontier = frontier[1:]
				if !m.InBounds(h) || m.Tiles[h] != TerrainPlain || isSpawnColumn(h, width) {
					continue
				}
				m.Tiles[h] = t
				size--
				for _, n := range m.Neighbors(h) {
					if r.Intn(2) == 0 {
						frontier = append(frontier, n)
					}
				}
			}
		}
	}

	blob(TerrainForest, 3, 9)
	blob(TerrainMountain, 2, 5)
	blob(TerrainWater, 2, 6)

	m.Rows = make([][]Terrain, height)
	for row := 0; row < height; row++ {
		m.Rows[row] = make([]Terrain, width)
		for col := 0; col < width; col++ {
			m.Rows[row][col] = m.Tiles[Hex{col, row}]
		}
	}
	return m
}

// isSpawnColumn — крайние колонки, где расставляются отряды.
func isSpawnColumn(h Hex, width int) bool {
	return h.Col <= 1 || h.Col >= width-2
}
