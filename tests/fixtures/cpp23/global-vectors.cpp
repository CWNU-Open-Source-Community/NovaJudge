#include <bits/stdc++.h>
using namespace std;

using ll = long long;
const int N = 2e5 + 10;

vector<int> a(N, 0);
vector<vector<int>> adj(N);

vector<ll> f(N, 0), g(N, 0), h(N, 0);
vector<ll> F(N, 0), G(N, 0), H(N, 0);

int main() {
    if (a.size() != N || adj.size() != N || f.size() != N || g.size() != N ||
        h.size() != N || F.size() != N || G.size() != N || H.size() != N) {
        return 1;
    }
    const ll sum = accumulate(a.begin(), a.end(), 0LL) +
        accumulate(f.begin(), f.end(), 0LL) + accumulate(g.begin(), g.end(), 0LL) +
        accumulate(h.begin(), h.end(), 0LL) + accumulate(F.begin(), F.end(), 0LL) +
        accumulate(G.begin(), G.end(), 0LL) + accumulate(H.begin(), H.end(), 0LL);
    if (sum != 0 || any_of(adj.begin(), adj.end(), [](const auto& v) { return !v.empty(); })) {
        return 2;
    }
    cout << N << " 0\n";
}
