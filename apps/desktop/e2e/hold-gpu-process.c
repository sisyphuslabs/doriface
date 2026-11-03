// Preloaded by first-document.e2e.ts into the app. Only in the unsandboxed zygote (--no-zygote-sandbox), whose first
// child is the GPU process, that first child waits DORIFACE_E2E_HOLD_GPU_PROCESS_MS before it runs; nothing else is
// held. The browser launches the network service only once the GPU process is up, so a launch's first attach lands
// while the first navigation is in flight and cannot commit yet: the state in which a bare attach loses the commit
// (#13). The held child writes "gpu process held pid=<pid> at=<ms>" when the hold starts and "gpu process released
// pid=<pid> at=<ms>" when it ends (wall-clock milliseconds) to the file DORIFACE_E2E_RACE_REPORT names, so the spec can
// check that the launch's attach happened while the hold was on.
#define _GNU_SOURCE
#include <fcntl.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static long hold_ms;
/* A copy: Chromium reuses the zygote's original environment block for its process title after startup. */
static char report_path[4096];
static atomic_int forks;

static void count_fork(void) { atomic_fetch_add(&forks, 1); }

static size_t append_number(char *line, size_t n, long long value) {
  char digits[24];
  size_t d = 0;
  do digits[d++] = (char)('0' + value % 10);
  while ((value /= 10) > 0 && d < sizeof digits);
  while (d > 0) line[n++] = digits[--d];
  return n;
}

/*
 * write(2) of "<what> pid=<pid> at=<ms>\n". This runs in a freshly forked child, so it makes only async-signal-safe
 * calls; the report path was read by the constructor, before any fork.
 */
static void report(const char *what) {
  if (report_path[0] == 0) return;
  char line[128];
  size_t n = strlen(what);
  if (n > sizeof line - 64) return;
  memcpy(line, what, n);
  memcpy(line + n, " pid=", 5);
  n = append_number(line, n + 5, getpid());
  struct timespec now;
  clock_gettime(CLOCK_REALTIME, &now);
  memcpy(line + n, " at=", 4);
  n = append_number(line, n + 4, (long long)now.tv_sec * 1000 + now.tv_nsec / 1000000);
  line[n++] = '\n';
  int fd = open(report_path, O_WRONLY | O_CREAT | O_APPEND, 0600);
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
  const char *path = getenv("DORIFACE_E2E_RACE_REPORT");
  if (path != NULL && strlen(path) < sizeof report_path) strcpy(report_path, path);
  if (hold_ms > 0) pthread_atfork(count_fork, NULL, hold_first_child);
}
