#include <array>
#include <expected>
#include <iostream>
#include <string>
#include <vector>

static_assert(__cplusplus >= 202100L, "This case must use C++23.");

constexpr int evaluation_mode() {
    if consteval {
        return 23;
    } else {
        return 7;
    }
}
static_assert(evaluation_mode() == 23);
constexpr bool constexpr_vector_works() {
    std::vector<int> values(4, 3);
    values.push_back(5);
    return values.size() == 5 && values.front() == 3 && values.back() == 5;
}
static_assert(constexpr_vector_works(), "Compiler flags must preserve legal constexpr vector evaluation.");

struct Grid {
    std::array<int, 4> values{};
    int& operator[](std::size_t row, std::size_t column) {
        return values.at(row * 2 + column);
    }
};

std::expected<int, std::string> checked_value(bool valid) {
    if (valid) return 42;
    return std::unexpected(std::string("invalid"));
}

int main() {
    Grid grid;
    grid[1, 0] = 9;
    auto value = checked_value(true);
    auto error = checked_value(false);
    if (!value || error || error.error() != "invalid") return 1;
    constexpr int compile_time_mode = evaluation_mode();
    std::cout << *value << ' ' << evaluation_mode() << ' '
              << compile_time_mode << ' ' << grid[1, 0] << '\n';
}
