package main

import (
	"log"
	"net/http"
	"os"

	"battleforge/backend/internal/httpapi"
	"battleforge/backend/internal/pikabu"
)

func main() {
	secret := os.Getenv("PIKABU_SECRET_KEY")
	if secret == "" {
		log.Fatal("PIKABU_SECRET_KEY не задан — ключ выдаётся в Студии Pikabu и не должен попадать в клиентский код")
	}

	addr := os.Getenv("ADDR")
	if addr == "" {
		addr = ":8080"
	}

	verifier := pikabu.NewVerifier(secret)
	server := httpapi.NewServer(verifier)

	log.Printf("battleforge backend слушает %s", addr)
	if err := http.ListenAndServe(addr, server.Routes()); err != nil {
		log.Fatal(err)
	}
}
