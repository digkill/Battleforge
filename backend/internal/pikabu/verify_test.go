package pikabu

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"testing"
)

func makeToken(t *testing.T, secret, headerJSON, payloadJSON string) string {
	t.Helper()
	header := base64.RawURLEncoding.EncodeToString([]byte(headerJSON))
	payload := base64.RawURLEncoding.EncodeToString([]byte(payloadJSON))
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(header + "." + payload))
	sig := base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
	return header + "." + payload + "." + sig
}

func TestVerify_ValidSignature(t *testing.T) {
	const secret = "test-secret"
	token := makeToken(t, secret, `{"typ":"JWT","alg":"HS256"}`, `{"id":"p1","name":"Ivan"}`)

	payload, err := NewVerifier(secret).Verify(token)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if string(payload) != `{"id":"p1","name":"Ivan"}` {
		t.Fatalf("unexpected payload: %s", payload)
	}
}

func TestVerify_WrongSecret(t *testing.T) {
	token := makeToken(t, "real-secret", `{"typ":"JWT","alg":"HS256"}`, `{"id":"p1"}`)

	_, err := NewVerifier("wrong-secret").Verify(token)
	if err != ErrInvalidSignature {
		t.Fatalf("expected ErrInvalidSignature, got %v", err)
	}
}

func TestVerify_TamperedPayload(t *testing.T) {
	const secret = "test-secret"
	token := makeToken(t, secret, `{"typ":"JWT","alg":"HS256"}`, `{"id":"p1"}`)

	parts := []byte(token)
	tampered := string(parts[:len(parts)-1]) + "x"

	_, err := NewVerifier(secret).Verify(tampered)
	if err == nil {
		t.Fatal("expected an error for tampered token")
	}
}

func TestVerify_MalformedToken(t *testing.T) {
	_, err := NewVerifier("secret").Verify("not-a-jwt")
	if err != ErrMalformedToken {
		t.Fatalf("expected ErrMalformedToken, got %v", err)
	}
}

func TestVerify_UnsupportedAlgorithm(t *testing.T) {
	const secret = "test-secret"
	token := makeToken(t, secret, `{"typ":"JWT","alg":"none"}`, `{"id":"p1"}`)

	_, err := NewVerifier(secret).Verify(token)
	if err == nil {
		t.Fatal("expected an error for unsupported algorithm")
	}
}
