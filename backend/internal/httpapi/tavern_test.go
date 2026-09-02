package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func doJSON(t *testing.T, ts *httptest.Server, method, path, playerID, body string) (*http.Response, map[string]any) {
	t.Helper()
	var rdr *bytes.Reader
	if body == "" {
		rdr = bytes.NewReader(nil)
	} else {
		rdr = bytes.NewReader([]byte(body))
	}
	req, err := http.NewRequest(method, ts.URL+path, rdr)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if playerID != "" {
		req.Header.Set("X-Player-Id", playerID)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("do: %v", err)
	}
	t.Cleanup(func() { res.Body.Close() })
	var out map[string]any
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res, out
}

func TestTavern_ListsHireableUnitsWithoutCreeps(t *testing.T) {
	s := startTestServer(t)
	ts := httptest.NewServer(s.Routes())
	defer ts.Close()

	res, body := doJSON(t, ts, "GET", "/api/tavern", "", "")
	if res.StatusCode != http.StatusOK {
		t.Fatalf("статус %d", res.StatusCode)
	}
	offers, _ := body["offers"].([]any)
	if len(offers) == 0 {
		t.Fatal("таверна пуста")
	}
	prev := -1
	for _, raw := range offers {
		o := raw.(map[string]any)
		if o["defId"] == "werewolf" {
			t.Fatal("крипов нанимать нельзя — их берут в бою")
		}
		cost := int(o["cost"].(float64))
		if cost <= 0 {
			t.Fatalf("цена %v у %v", cost, o["defId"])
		}
		if cost < prev {
			t.Fatal("предложения должны идти по возрастанию цены")
		}
		prev = cost
	}
}

func TestTavern_HireSpendsGoldAndAddsUnit(t *testing.T) {
	s := startTestServer(t)
	ts := httptest.NewServer(s.Routes())
	defer ts.Close()

	// Стартовых 500 золота на воина не хватит — докидываем.
	s.players.AddGold("lord", 100000)
	before := s.players.GetOrCreate("lord")

	res, body := doJSON(t, ts, "POST", "/api/tavern/hire", "lord", `{"defId":"warrior"}`)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("статус %d, тело %v", res.StatusCode, body)
	}

	after := s.players.GetOrCreate("lord")
	if len(after.Units) != len(before.Units)+1 {
		t.Fatalf("юнитов %d, ожидали %d", len(after.Units), len(before.Units)+1)
	}
	if after.Gold >= before.Gold {
		t.Fatalf("золото не списано: было %d, стало %d", before.Gold, after.Gold)
	}
}

func TestTavern_HireRejectedWithoutGold(t *testing.T) {
	s := startTestServer(t)
	ts := httptest.NewServer(s.Routes())
	defer ts.Close()

	// Стартовые 500 заведомо меньше цены любого юнита.
	res, _ := doJSON(t, ts, "POST", "/api/tavern/hire", "pauper", `{"defId":"knight"}`)
	if res.StatusCode != http.StatusPaymentRequired {
		t.Fatalf("ожидали 402, получили %d", res.StatusCode)
	}
	if p := s.players.GetOrCreate("pauper"); len(p.Units) != 3 {
		t.Fatalf("юнит добавлен несмотря на нехватку золота: %d", len(p.Units))
	}
}

func TestTavern_CreepCannotBeHired(t *testing.T) {
	s := startTestServer(t)
	ts := httptest.NewServer(s.Routes())
	defer ts.Close()

	s.players.AddGold("lord", 100000)
	res, _ := doJSON(t, ts, "POST", "/api/tavern/hire", "lord", `{"defId":"werewolf"}`)
	if res.StatusCode != http.StatusNotFound {
		t.Fatalf("ожидали 404 на найм крипа, получили %d", res.StatusCode)
	}
}
