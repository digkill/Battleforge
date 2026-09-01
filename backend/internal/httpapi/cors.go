package httpapi

import "net/http"

// withCORS разрешает запросы с любого origin: игра встраивается в iframe
// платформы Pikabu Games (games.pikabu.ru) и одновременно должна быть
// доступна с локального dev-сервера фронтенда. Авторизация идёт не через
// cookies, а через заголовок X-Player-Id, так что credentials не нужны.
func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-Player-Id")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
