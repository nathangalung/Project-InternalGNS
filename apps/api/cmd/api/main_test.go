package main

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Marks the child API process.
const childEnv = "GNS_API_SMOKE_CHILD"

// TestMain runs main as child.
// The smoke re-executes this test binary with childEnv set, so main runs
// exactly as the container runs it: flags, config from the environment,
// signals and exit codes.
func TestMain(m *testing.M) {
	if os.Getenv(childEnv) == "1" {
		main()
		os.Exit(0)
	}
	os.Exit(m.Run())
}

// bootEnv is the container environment.
type bootEnv struct {
	dsn   string
	addr  string
	email string
	jwt   string
}

func (e bootEnv) list() []string {
	return []string{
		childEnv + "=1",
		"PATH=" + os.Getenv("PATH"),
		"HOME=" + os.Getenv("HOME"),
		"ENV=test",
		"DATABASE_URL=" + e.dsn,
		"JWT_SECRET=" + e.jwt,
		"HTTP_ADDR=" + e.addr,
		"SUPERADMIN_EMAIL=" + e.email,
		"SUPERADMIN_NAME=Boot Smoke",
		"SUPERADMIN_PASSWORD=Boot-smoke-pw1!",
		"TZ=Asia/Jakarta",
		"MINIO_ACCESS_KEY=",
		"MINIO_SECRET_KEY=",
	}
}

// child builds one binary run.
// It runs in an empty directory so a developer's .env cannot leak in.
func child(t *testing.T, env bootEnv, out *bytes.Buffer, args ...string) *exec.Cmd {
	t.Helper()
	cmd := exec.Command(os.Args[0], args...)
	cmd.Dir = t.TempDir()
	cmd.Env = env.list()
	cmd.Stdout = out
	cmd.Stderr = out
	return cmd
}

// exitCode waits and returns the status.
func exitCode(t *testing.T, cmd *exec.Cmd, timeout time.Duration) int {
	t.Helper()
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	select {
	case err := <-done:
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			return exit.ExitCode()
		}
		if err != nil {
			t.Fatalf("wait: %v", err)
		}
		return 0
	case <-time.After(timeout):
		_ = cmd.Process.Kill()
		t.Fatalf("process did not exit within %s", timeout)
		return -1
	}
}

func run(t *testing.T, env bootEnv, args ...string) (int, string) {
	t.Helper()
	var out bytes.Buffer
	cmd := child(t, env, &out, args...)
	if err := cmd.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	code := exitCode(t, cmd, 60*time.Second)
	return code, out.String()
}

func freeAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer l.Close()
	return fmt.Sprintf(":%d", l.Addr().(*net.TCPAddr).Port)
}

// newEnv prepares a test boot.
// The superadmin the boot seeds is deleted afterwards.
func newEnv(t *testing.T) bootEnv {
	t.Helper()
	pool := testutil.Pool(t)
	cleaner := testutil.NewCleaner(t)
	env := bootEnv{
		dsn:   testutil.DSN(),
		addr:  freeAddr(t),
		email: fmt.Sprintf("boot-smoke-%d@test.local", time.Now().UnixNano()),
		jwt:   "boot-smoke-signing-key-0123456789abcdef",
	}
	t.Cleanup(func() {
		var id int64
		err := pool.QueryRow(context.Background(), `SELECT id FROM users WHERE email = $1`, env.email).Scan(&id)
		if err == nil {
			cleaner.User(id)
		}
	})
	return env
}

func get(url string) (int, error) {
	c := &http.Client{Timeout: 2 * time.Second}
	res, err := c.Get(url)
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	return res.StatusCode, nil
}

// Bootstrap migrates, seeds and exits cleanly.
func TestBoot_Bootstrap(t *testing.T) {
	env := newEnv(t)
	code, out := run(t, env, "-bootstrap")
	if code != 0 {
		t.Fatalf("bootstrap exit = %d, want 0\n%s", code, out)
	}
	if !strings.Contains(out, "bootstrap done") {
		t.Fatalf("bootstrap did not report completion:\n%s", out)
	}
	if strings.Contains(out, `"level":"ERROR"`) {
		t.Fatalf("bootstrap logged an error:\n%s", out)
	}
	var role string
	err := testutil.Pool(t).QueryRow(context.Background(),
		`SELECT role FROM users WHERE email = $1 AND is_active`, env.email).Scan(&role)
	if err != nil || role != "superadmin" {
		t.Fatalf("seeded superadmin: role=%q err=%v", role, err)
	}
}

// Server boots, serves, then drains.
// The container healthcheck runs the same binary with -healthcheck, so it
// has to agree with the server while it is up and after it is gone.
func TestBoot_ServeAndShutdown(t *testing.T) {
	env := newEnv(t)
	var out bytes.Buffer
	cmd := child(t, env, &out)
	if err := cmd.Start(); err != nil {
		t.Fatalf("start: %v", err)
	}
	stopped := false
	t.Cleanup(func() {
		if !stopped {
			_ = cmd.Process.Kill()
			_ = cmd.Wait()
		}
	})

	base := "http://127.0.0.1" + env.addr
	deadline := time.Now().Add(60 * time.Second)
	for {
		if status, err := get(base + "/readyz"); err == nil && status == http.StatusOK {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("server never became ready\n%s", out.String())
		}
		time.Sleep(100 * time.Millisecond)
	}
	if status, err := get(base + "/healthz"); err != nil || status != http.StatusOK {
		t.Fatalf("healthz = %d, %v", status, err)
	}
	if status, err := get(base + "/api/v1/auth/me"); err != nil || status != http.StatusUnauthorized {
		t.Fatalf("auth/me without a token = %d, %v; want 401", status, err)
	}
	if code, probe := run(t, env, "-healthcheck"); code != 0 {
		t.Fatalf("healthcheck while up = %d, want 0\n%s", code, probe)
	}

	if err := cmd.Process.Signal(syscall.SIGTERM); err != nil {
		t.Fatalf("signal: %v", err)
	}
	code := exitCode(t, cmd, 30*time.Second)
	stopped = true
	logs := out.String()
	if code != 0 {
		t.Fatalf("exit after SIGTERM = %d, want 0\n%s", code, logs)
	}
	for _, want := range []string{`"msg":"listening"`, `"msg":"shutting down"`} {
		if !strings.Contains(logs, want) {
			t.Fatalf("log lacks %s\n%s", want, logs)
		}
	}
	if strings.Contains(logs, `"level":"ERROR"`) {
		t.Fatalf("a clean start and stop logged an error\n%s", logs)
	}

	if code, probe := run(t, env, "-healthcheck"); code != 1 {
		t.Fatalf("healthcheck after shutdown = %d, want 1\n%s", code, probe)
	}
}

// Failed boots exit with reason.
func TestBoot_Refusals(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*bootEnv)
		want   string
	}{
		{"weak signing key", func(e *bootEnv) { e.jwt = "short" }, `"msg":"load config"`},
		{"unreachable database", func(e *bootEnv) {
			e.dsn = "postgres://nobody:nothing@127.0.0.1:1/none?sslmode=disable&connect_timeout=2"
		}, `"msg":"build server"`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			env := newEnv(t)
			c.mutate(&env)
			code, out := run(t, env, "-bootstrap")
			if code != 1 {
				t.Fatalf("exit = %d, want 1\n%s", code, out)
			}
			if !strings.Contains(out, c.want) {
				t.Fatalf("output lacks %s\n%s", c.want, out)
			}
		})
	}
}
