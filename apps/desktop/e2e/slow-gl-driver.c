// Preloaded by gl-driver.e2e.ts into the app so that loading Mesa's GL driver takes DORIFACE_E2E_SLOW_GL_SECONDS,
// the way it does on a cold CI runner, where the first load of libLLVM and libgallium from disk can take over 30 s (#80).
#define _GNU_SOURCE
#include <dlfcn.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

static int is_mesa_driver(const char *file) {
  return strstr(file, "libGLX_mesa") != NULL || strstr(file, "libEGL_mesa") != NULL ||
         strstr(file, "libgallium") != NULL || strstr(file, "_dri.so") != NULL;
}

void *dlopen(const char *file, int mode) {
  static void *(*next)(const char *, int);
  if (next == NULL) next = (void *(*)(const char *, int))dlsym(RTLD_NEXT, "dlopen");
  const char *seconds = getenv("DORIFACE_E2E_SLOW_GL_SECONDS");
  if (file != NULL && seconds != NULL && is_mesa_driver(file)) sleep((unsigned)atoi(seconds));
  return next(file, mode);
}
