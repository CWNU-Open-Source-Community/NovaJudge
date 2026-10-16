#include<bits/stdc++.h>
#define endl '\n'
#define ll long long
#define ull unsigned long long
#define i128 __int128
using namespace std;
const int N = 2e5+10;
int n;
vector<int> a(N, 0);
vector<vector<int>> adj(N);
vector<ll> f(N, 0), g(N, 0), h(N, 0);
vector<ll> F(N, 0), G(N, 0), H(N, 0);
void dfs1(int u, int fa) {
    for (auto v : adj[u]) {
        if (v == fa) continue;
        dfs1(v, u);
        f[u] += f[v] + 2 * g[v] + h[v];
        g[u] += g[v] + h[v];
        h[u] += h[v];
    }
}
void dfs2(int u, int fa) {
    for (auto v : adj[u]) {
        if (v == fa) continue;
        F[v] =
            f[v] +
            (F[u] - (f[v] + 2 * g[v] + h[v])) +
            2 * (G[u] - (g[v] + h[v])) +
            (H[u] - h[v]);
        G[v] = g[v] + (G[u] - (g[v] + h[v]) + H[u] - h[v]);
        H[v] = H[u];
        dfs2(v, u);
    }
}
int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    cin >> n;
    for (int i = 1; i <= n; i++) {
        cin >> a[i];
        h[i] = a[i];
    }
    for (int i = 1; i <= n - 1; i++) {
        int u, v;
        cin >> u >> v;
        adj[u].push_back(v);
        adj[v].push_back(u);
    }
    dfs1(1, 0);
    F[1] = f[1]; G[1] = g[1]; H[1] = h[1];
    dfs2(1, 0);
    ll ans = 1e18, pos = -1;
    for (int i = 1; i <= n; i++) {
        if (ans > F[i]) {
            ans = F[i];
            pos = i;
        }
    }
    cout << ans << " " << pos << endl;


    return 0;
}
