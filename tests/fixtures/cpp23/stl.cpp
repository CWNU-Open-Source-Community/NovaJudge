#include <bits/stdc++.h>
using namespace std;

int main() {
    vector<int> values{5, 1, 3, 1, 4};
    sort(values.begin(), values.end());
    values.erase(unique(values.begin(), values.end()), values.end());
    map<string, int> counts{{"alpha", 2}, {"beta", 3}};
    priority_queue<int> heap(values.begin(), values.end());
    int count = 0;
    for (const auto& [name, frequency] : counts) {
        if (!name.empty()) count += frequency;
    }
    cout << accumulate(values.begin(), values.end(), 0) << ' '
         << heap.top() << ' ' << count << '\n';
}
