// Preloaded by first-document.e2e.ts into the app: every process the zygote forks (the window's renderer among them)
// waits DORIFACE_E2E_HOLD_RENDERER_MS before it runs, so Playwright attaches while the first navigation is still in
// flight, the state #13's failing launches were in.
#define _GNU_SOURCE
#include <fcntl.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static long hold_ms;

static void hold_child(void) {
  struct timespec wait = {hold_ms / 1000, (hold_ms % 1000) * 1000000L};
  nanosleep(&wait, NULL);
}

static int is_zygote(void) {
  char cmdline[4096];
  int fd = open("/proc/self/cmdline", O_RDONLY);
  if (fd < 0) return 0;
  ssize_t n = read(fd, cmdline, sizeof cmdline - 1);
  close(fd);
  if (n <= 0) return 0;
  for (ssize_t i = 0; i < n; i++)
    if (cmdline[i] == 0) cmdline[i] = ' ';
  cmdline[n] = 0;
  return strstr(cmdline, "--type=zygote") != NULL;
}

__attribute__((constructor)) static void install(void) {
  const char *ms = getenv("DORIFACE_E2E_HOLD_RENDERER_MS");
  if (ms == NULL || !is_zygote()) return;
  hold_ms = atol(ms);
  if (hold_ms > 0) pthread_atfork(NULL, NULL, hold_child);
}
