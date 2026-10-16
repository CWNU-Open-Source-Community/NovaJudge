# C++23 compiler resource fix

## Scope and diagnosis

The original image installs Ubuntu 24.04's `14.2.0-4ubuntu2~24.04.1` GCC packages.
Global, fixed-size `std::vector` initialization becomes particularly expensive
with C++20/23. GCC's [PR c++/113835 fix](https://github.com/gcc-mirror/gcc/commit/8dce1aa0579ab86a626e24c0af29455f30305595)
explains the unsuccessful trial constant evaluation of a vector constructor:
the allocated storage cannot escape as the result of that constant evaluation.
The fixed compiler skips that attempt for the affected constructor. The fix
preserves required constant evaluation and runtime initialization semantics.

The repository includes the user's complete original submission in
`tests/fixtures/cpp23/original-tree-dp.cpp` and a separate constructed reproducer
in `tree-dp.cpp`. The original was supplied after the initial toolchain fix and
is now tested directly. Only pasted indentation (including non-breaking spaces)
and trailing whitespace were normalized; all program logic is unchanged. Other
cases isolate the header, global initialization, STL, C++23 features, C, Java
and PyPy3.

## Toolchain and changes

- GCC/G++ **15.2.0**, from the official Docker image
  `gcc:15.2.0-bookworm@sha256:9ca91b05c7b07d2979f16413e8b2cd6ec8a7c80ffca4121ccab0aeba33f90460`.
- Copy its `/usr/local` installation into the existing Ubuntu 24.04 runtime;
  install Ubuntu's linker, libc development headers and zstd runtime. Keep
  `/usr/bin/gcc`, `/usr/bin/g++`, `/usr/bin/cc`, `/usr/bin/c++` entry points.
- Register GCC's shared libraries with `ldconfig`, including dynamic linking
  used by checker/interactor/communicator compilation. Verify both compiler
  versions during image build.
- Bookworm is deliberate: its older glibc is compatible with the Ubuntu 24.04
  runtime. A GCC image based on a newer distribution must not be substituted
  without checking libc requirements. The compiler image is pinned; the
  existing Ubuntu base and other apt dependencies remain distribution-managed.
- No language limits, application compilation flags, Worker logic, schema,
  frontend status classification or Compose configuration change. C++23,
  `-O2`, and static contestant linking remain enabled. No constexpr limits
  are reduced. GCC 15.2 includes the upstream fix; no compiler patch is carried.

Production C++ command remains:

```sh
/usr/bin/g++ main.cpp -o main -O2 -Wall -lm -static -std=c++23
```

## Measurements

Measured on 2026-10-16, Linux/amd64 Docker Desktop engine 29.1.3, cgroup v1,
with go-judge v1.11.2 and sequential requests on the same machine. The baseline
was built from the unmodified public master Dockerfile. CPU and peak memory
below come from go-judge `/run`, not wall-clock timers. Full commands, source
hashes, measurements and execution checks are in [CPP23_COMPILER_RESULTS.json](CPP23_COMPILER_RESULTS.json).

| Case | Standard | GCC 14.2 CPU / peak MiB | GCC 14.2 result | GCC 15.2 CPU / peak MiB | GCC 15.2 result |
| --- | --- | --- | --- | --- | --- |
| bits | c++17 | 0.795 s / 180.34 | Accepted | 0.717 s / 174.66 | Accepted |
| bits | c++23 | 1.349 s / 300.16 | Accepted | 1.214 s / 292.73 | Accepted |
| globals | c++17 | 0.760 s / 189.26 | Accepted | 0.676 s / 179.87 | Accepted |
| globals | c++23 | 9.485 s / 1024.02 | Memory Limit Exceeded | 1.338 s / 301.10 | Accepted |
| tree | c++17 | 0.850 s / 191.03 | Accepted | 0.713 s / 181.64 | Accepted |
| tree | c++23 | 9.053 s / 1024.02 | Memory Limit Exceeded | 1.395 s / 302.80 | Accepted |
| stl | c++17 | 0.848 s / 194.89 | Accepted | 0.790 s / 187.66 | Accepted |
| stl | c++23 | 1.448 s / 315.30 | Accepted | 1.401 s / 307.58 | Accepted |
| features | c++23 | 0.525 s / 119.07 | Accepted | 0.549 s / 131.03 | Accepted |
| c | c | 0.036 s / 30.59 | Accepted | 0.036 s / 31.02 | Accepted |
| java | java | 0.951 s / 73.56 | Accepted | 0.930 s / 75.48 | Accepted |

All accepted programs also executed with expected output. PyPy3 executed
successfully (no compile step). The two tree samples exercise rerooting and the
one-node boundary. GNU++23 and dynamically linked tree/C++23-feature programs
also compiled and ran successfully. Three additional static C++23 tree runs
took 1.253–1.376 CPU seconds and 302.27–302.66 MiB.

The baseline tree also failed with MLE without `-static` (9.360 CPU seconds,
1024.02 MiB). A **diagnostic-only** run at 30 CPU seconds / 2 GiB completed in
10.407 CPU seconds at 1681.85 MiB; it does not satisfy original limits. Its
`-ftime-report` attributed 7.84 seconds wall time and 2050 MiB of cumulative GGC
allocation to constant expression evaluation. GCC 15.2 reported 0.03 seconds
and 2706 KiB for that phase (GGC is not peak memory). These measurements and the
matching upstream fix support PR113835 as the cause for this reproducer.

The candidate satisfies the unchanged 10-second / 1-GiB limits for all tested
cases, with no downgrade of the language standard or optimization level.
This is not a claim that every C++23 feature or every competition program is
supported. The subsequently supplied original program is covered below.
Only amd64/cgroup v1 was measured locally; other architectures and cgroup v2
deployment hosts require the same smoke checks before rollout.

## Original submission follow-up

The actual user program was tested with the same existing images, compiler
flags, and original 10-second CPU / 1-GiB sandbox limits. No toolchain or
application code changed in this follow-up. Four independently checked inputs
cover a weighted branched tree, one vertex, a two-vertex tie, and a weighted
chain. Outputs are respectively `18 3`, `0 1`, `1 1`, and `10 3`.

| Original program configuration | CPU seconds | Peak MiB | Compile / execution |
| --- | ---: | ---: | --- |
| GCC 14.2, C++17 | 0.898 | 222.73 | Accepted / all 4 correct |
| GCC 14.2, C++23, original limits | 9.369 | 1024.02 | MLE / not executed |
| GCC 14.2, C++23, diagnostic 30 s / 2 GiB | 10.184 | 1685.92 | Accepted / all 4 correct; not acceptance |
| GCC 15.2, C++17 | 0.778 | 224.14 | Accepted / all 4 correct |
| GCC 15.2, C++23, original limits | 1.316 | 301.54 | Accepted / all 4 correct |
| GCC 15.2, C++23, dynamic linking | 1.308 | 301.14 | Accepted / all 4 correct |

The GCC 14 diagnostic report attributes 7.62 seconds wall time and 2050 MiB
cumulative GGC allocations to constant expression evaluation. The original
submission therefore reproduces the same failure and meets the unchanged
resource limits with GCC 15.2. Detailed commands, source hash and execution
outputs are in [CPP23_ORIGINAL_RESULTS.json](CPP23_ORIGINAL_RESULTS.json).
The earlier measurement JSON remains an unchanged historical record of the
constructed fixtures, which were run before the original was supplied.

Run only the original-program check (also included in the default suite):

```sh
node scripts/test-cpp23-compiler.mjs --url http://127.0.0.1:15050 \
  --cases original --label original-submission --output cpp23-original.json
```

## Reproducing the focused checks

Node.js 18+ and Docker are sufficient; no npm install, database or Redis is
needed. Build from the public repository. A historical baseline can be built
from the Dockerfile at commit `23400c125dfcc2639ed0c97a81470a9b02a92ead`.
Use dedicated names and loopback ports so tests do not reach an existing judge:

```sh
docker build -t novajudge-cpp23:verified .
docker run -d --name novajudge-cpp23-test --privileged --shm-size=256m \
  -p 127.0.0.1:15050:5050 novajudge-cpp23:verified
curl --fail http://127.0.0.1:15050/config
node scripts/test-cpp23-compiler.mjs --url http://127.0.0.1:15050 \
  --label gcc15-public --output cpp23-public.json
node scripts/test-cpp23-compiler.mjs --url http://127.0.0.1:15050 \
  --cases tree,features --standards c++23 --no-static \
  --label gcc15-dynamic --output cpp23-dynamic.json
# Remove only the disposable test container.
docker rm -f novajudge-cpp23-test
```

The harness requires an explicit endpoint, sends the actual compile flags and
10-second CPU / 1-GiB limits, executes each cached binary, checks its output,
and deletes its cache IDs. JSON contains source hashes and exact commands.
Use `--repeat 3` for repeated measurements. `--standards gnu++23` checks GNU
mode separately; it does not change the production language setting.
On hosts requiring explicit cgroup configuration, also use the deployment's
validated cgroup namespace/mount options for the disposable container.

For a failing baseline only, `--diagnostic-cpu-seconds 30
--diagnostic-memory-mib 2048 --extra-flag=-ftime-report` can reveal the full
resource cost. Such reports explicitly have `diagnosticOnly: true` and cannot
count as acceptance. `-ftime-report`'s GGC allocation totals are not peak RSS;
use go-judge's `memory` field for the sandbox comparison.

## Deployment after downstream synchronization

Run the following on the deployment host only after operator approval, from
the production checkout. Preserve that checkout's independent Compose and
go-judge version/configuration. Do not run a generic all-service upgrade script.
Pause new judging and let active Worker jobs drain using the deployment's normal
Worker controls; replacing go-judge interrupts in-flight calls and cached file
IDs. Other services can remain running.

```sh
# Record rollback state BEFORE updating the production checkout.
set -eu
test -z "$(git status --porcelain)" || { echo 'Resolve local changes first'; exit 1; }
test "$(git branch --show-current)" = master
git remote get-url origin # Confirm this is the private deployment repository.
old_commit=$(git rev-parse HEAD)
judge_container=$(docker compose ps -q go-judge)
old_image=$(docker inspect --format '{{.Image}}' "$judge_container")
rollback_tag="novajudge-go-judge:rollback-$(date +%Y%m%d%H%M%S)"
docker image tag "$old_image" "$rollback_tag"
printf 'commit=%s\nimage=%s\ntag=%s\n' "$old_commit" "$old_image" "$rollback_tag"

# The production checkout's origin must be the private deployment repository.
git status --short
git fetch origin master
git merge --ff-only origin/master
# Abort on local modifications/conflicts and resolve them before proceeding.
docker compose build go-judge
# Optional preflight: run the built image on a spare loopback port and use
# the regression command above before replacing the deployed container.
docker compose up -d --no-deps --no-build go-judge
docker compose exec -T go-judge /usr/bin/gcc -dumpfullversion
docker compose exec -T go-judge /usr/bin/g++ -dumpfullversion
# Both must print 15.2.0.
curl --fail http://127.0.0.1:5050/config
node scripts/test-cpp23-compiler.mjs --url http://127.0.0.1:5050 \
  --label deployed --output cpp23-deployed.json
# Resume Workers only after health and compile/execute checks pass.
```

Only go-judge is built/recreated. PostgreSQL, Redis and their volumes remain
running. Do not use `docker compose down`, `down -v`, volume pruning, or a
repository-wide deployment script for this compiler update. Existing on-disk
judge-program binary caches remain valid and are not automatically rebuilt;
if recompilation is desired, pause Workers and back up the relevant cache
folders before removing only those cache entries.

Rollback requires the recorded old image, not a rebuild from floating apt
repositories. While judging is paused/drained:

```sh
# Use the saved rollback_tag value from the deployment record.
printf 'services:\n  go-judge:\n    image: %s\n' "$rollback_tag" > /tmp/novajudge-compiler-rollback.yml
docker compose -f docker-compose.yml -f /tmp/novajudge-compiler-rollback.yml \
  up -d --no-deps --no-build --force-recreate go-judge
curl --fail http://127.0.0.1:5050/config
docker compose exec -T go-judge /usr/bin/g++ -dumpfullversion
```

Include the deployment's usual override files, in their usual order, before
the rollback override. No source rollback is needed for an image-only failure:
the application flags and Compose are unchanged. If reverting the source fix is
also required, use a reviewed `git revert` in the private repository; do not
reset its master or overwrite independent configuration.
