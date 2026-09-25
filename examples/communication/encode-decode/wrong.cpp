#include <iostream>
#include <string>

int main() {
    std::string phase;
    if (!(std::cin >> phase)) return 1;

    if (phase == "first") {
        int n;
        if (!(std::cin >> n)) return 1;
        std::string message;
        for (int i = 0; i < n; ++i) {
            int value;
            if (!(std::cin >> value)) return 1;
            message += static_cast<char>('a' + value - 1);
        }
        std::cout << message << '\n';
        return 0;
    }

    if (phase == "second") {
        std::string message;
        if (!(std::cin >> message)) return 1;
        std::cout << message.size();
        for (char letter : message) {
            // Deliberately shift every decoded value while keeping it in range.
            std::cout << ' ' << (letter - 'a' + 1) % 26 + 1;
        }
        std::cout << '\n';
        return 0;
    }

    return 1;
}
