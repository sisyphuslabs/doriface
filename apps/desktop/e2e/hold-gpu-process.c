// Preloaded by first-document.e2e.ts into the app. Only in the unsandboxed zygote (--no-zygote-sandbox), whose first
// child is the GPU process, that first child waits DORIFACE_E2E_HOLD_GPU_PROCESS_MS before it runs; nothing else is
// held. The browser launches the network service only once the GPU process is up, so a launch's first attach lands
// while the first navigation is in flight and cannot commit yet: the state in which a bare attach loses the commit
// (#13). The held child writes "gpu process held pid=<pid>" when the hold starts and "gpu process released pid=<pid>"
// when it ends to the file DORIFACE_E2E_RACE_REPORT names, so the spec can check that the hold covered the attach.
#define _GNU_SOURCE
#include <fcntl.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static long hold_ms;
static atomic_int forks;

static void count_fork(void) { atomic_fetch_add(&forks, 1); }

/* write(2) of "<what> pid=<pid>\n"; only async-signal-safe calls, as this runs in a freshly forked child. */
static void report(const char *what) {
  const char *path = getenv("DORIFACE_E2E_RACE_REPORT");
  if (path == NULL) return;
  char line[96];
  size_t n = strlen(what);
  if (n > sizeof line - 32) return;
  memcpy(line, what, n);
  memcpy(line + n, " pid=", 5);
  n += 5;
  char digits[16];
  size_t d = 0;
  for (long pid = getpid(); pid > 0 && d < sizeof digits; pid /= 10) digits[d++] = (char)('0' + pid % 10);
  while (d > 0) line[n++] = digits[--d];
  line[n++] = '\n';
  int fd = open(path, O_WRONLY | O_CREAT | O_APPEND, 0600);
  if (fd < 0) return;
  ssize_t written = write(fd, line, n);
  (void)written;
  close(fd);
}

static void hold_first_child(void) {
  if (atomic_load(&forks) != 1) return;
  report("gpu process held");
  struct timespec wait = {hold_ms / 1000, (hold_ms % 1000) * 1000000L};
  nanosleep(&wait, NULL);
  report("gpu process released");
}

static int is_unsandboxed_zygote(void) {
  char cmdline[4096];
  int fd = open("/proc/self/cmdline", O_RDONLY);
  if (fd < 0) return 0;
  ssize_t n = read(fd, cmdline, sizeof cmdline - 1);
  close(fd);
  if (n <= 0) return 0;
  for (ssize_t i = 0; i < n; i++)
    if (cmdline[i] == 0) cmdline[i] = ' ';
  cmdline[n] = 0;
  return strstr(cmdline, "--type=zygote") != NULL && strstr(cmdline, "--no-zygote-sandbox") != NULL;
}

__attribute__((constructor)) static void install(void) {
  const char *ms = getenv("DORIFACE_E2E_HOLD_GPU_PROCESS_MS");
  if (ms == NULL || !is_unsandboxed_zygote()) return;
  hold_ms = atol(ms);
  if (hold_ms > 0) pthread_atfork(count_fork, NULL, hold_first_child);
}
