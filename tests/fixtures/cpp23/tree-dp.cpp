// Constructed regression program; the user submission is original-tree-dp.cpp.
// For each vertex, compute sum(weight * distance) and sum(weight * distance^2).
// Iterative subtree DP and rerooting exercise every supplied global vector.
#include <bits/stdc++.h>
using namespace std;

using ll = long long;
const int N = 2e5 + 10;

vector<int> a(N, 0);
vector<vector<int>> adj(N);

vector<ll> f(N, 0), g(N, 0), h(N, 0);
vector<ll> F(N, 0), G(N, 0), H(N, 0);

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    int n;
    if (!(cin >> n) || n < 1 || n >= N) return 1;
    for (int u = 1; u <= n; ++u) cin >> a[u];
    for (int i = 1; i < n; ++i) {
        int u, v;
        cin >> u >> v;
        adj[u].push_back(v);
        adj[v].push_back(u);
    }

    vector<int> parent(n + 1, 0), order{1};
    for (size_t i = 0; i < order.size(); ++i) {
        const int u = order[i];
        for (int v : adj[u]) {
            if (v == parent[u]) continue;
            parent[v] = u;
            order.push_back(v);
        }
    }
    for (auto it = order.rbegin(); it != order.rend(); ++it) {
        const int u = *it;
        f[u] += a[u];
        for (int v : adj[u]) {
            if (parent[v] != u) continue;
            f[u] += f[v];
            g[u] += g[v] + f[v];
            h[u] += h[v] + 2 * g[v] + f[v];
        }
    }
    F[1] = f[1];
    G[1] = g[1];
    H[1] = h[1];
    for (int u : order) {
        for (int v : adj[u]) {
            if (parent[v] != u) continue;
            F[v] = F[u];
            G[v] = G[u] + F[u] - 2 * f[v];
            H[v] = H[u] + 2 * G[u] + F[u] - 4 * (g[v] + f[v]);
        }
    }
    for (int u = 1; u <= n; ++u) cout << G[u] << ' ' << H[u] << '\n';
}
