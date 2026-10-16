# C++ compiler regression fixtures

Run from the repository with Node.js 18+ and a **separate test go-judge container**:

```sh
node scripts/test-cpp23-compiler.mjs --url http://127.0.0.1:15050 --label candidate --output candidate.json
```

The runner does not read `.env`, use the application, access Redis/PostgreSQL, or
choose a default endpoint. It compiles and executes sequentially through `/run`
and deletes cached executable IDs. The default compilation request matches
`lib/judge.ts`: `-O2 -Wall -lm -static`, 10 CPU seconds, 1 GiB, and 50 processes.
It tests both `c++17` and `c++23`, except the C++23-only feature case. The report
records source hashes, exact commands, compiler versions, CPU nanoseconds and
seconds, peak bytes and MiB, sandbox status, and sample-output comparisons.

| Case | Purpose |
| --- | --- |
| `bits` | Isolate the cost of including `bits/stdc++.h`. |
| `globals` | The supplied `N = 200010` global vectors, with observable size/zero checks. |
| `tree` | Complete constructed tree DP using all eight supplied global vectors. |
| `original` | The user's complete recursive tree DP, minimizing weighted squared distance and returning the first minimizing vertex. |
| `stl` | `bits/stdc++.h`, vectors, sorting, map, heap, and structured bindings. |
| `features` | C++23 `std::expected`, `if consteval`, multidimensional subscripting, and a constexpr-vector `static_assert`. |
| `c` / `java` / `pypy3` | Compile where applicable and execute a minimal sum program. |

`tree-dp.cpp` is **constructed for this regression**, not the user's original
submission. It computes, for each vertex `u`,
`sum(weight[v] * distance(u,v))` and `sum(weight[v] * distance(u,v)^2)`.
The subtree arrays `f/g/h` hold weight, first moment, and second moment; `F/G/H`
hold the corresponding values after rerooting. A five-vertex weighted tree and
a one-vertex boundary case have independently calculable expected outputs.
`original-tree-dp.cpp` preserves the complete source subsequently supplied by
the user. Only pasted indentation (including non-breaking spaces) and trailing
whitespace were normalized; declarations, recursion, DP formulas and output are
unchanged. Four independently checked samples cover a weighted branched tree,
a single vertex, a tie resolved by vertex order, and a weighted chain.
Run only this follow-up with `--cases original`; its default standards are
C++17 and C++23. These checks do not claim support for every C++23 feature or
exhaustive correctness of the submitted algorithm.

For isolated compiler comparisons, use `--cpp /usr/bin/g++-15`,
`--cases globals,tree`, `--standards c++23`, or a repeatable
`--extra-flag=--param=...`. `--no-static` permits a link-mode comparison.
Use `--repeat 3` to record variation rather than conflating it with a toolchain
effect. Do not run comparison containers concurrently when measuring CPU time.

When measuring a failing baseline beyond the original limits, explicitly add
`--diagnostic-cpu-seconds 30` and/or `--diagnostic-memory-mib 1536`. Such a report
has `diagnosticOnly: true` and `acceptancePassed: false`, even if compilation
succeeds. A candidate must be rerun with the original limits for acceptance.
