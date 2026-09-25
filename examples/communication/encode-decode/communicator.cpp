#include "testlib.h"
#include <iostream>
#include <string>
#include <vector>

int main(int argc, char* argv[]) {
    if (argc != 5) {
        std::cerr << "Expected: communicator input.in user.out answer.out prepare|check\n";
        return 3;
    }
    const std::string mode = argv[4];
    // The last argument belongs to NovaJudge, not testlib's report-file option.
    registerTestlibCmd(4, argv);

    inf.readToken("first", "phase");
    const int n = inf.readInt(1, 10000, "n");
    std::vector<int> original(n);
    for (int i = 0; i < n; ++i) {
        original[i] = inf.readInt(1, 26, "value");
    }
    if (!inf.seekEof()) quitf(_fail, "Unexpected data in the input file");

    if (mode == "prepare") {
        const std::string message = ouf.readToken("[a-z]{1,100000}", "message");
        if (!ouf.seekEof()) quitf(_pe, "Expected one encoded string");

        // Only this stdout becomes the second run's input.
        std::cout << "second\n" << message << std::endl;
        quitf(_ok, "First run message is valid");
    }

    if (mode == "check") {
        const int decodedSize = ouf.readInt(1, 10000, "decodedSize");
        if (decodedSize != n) quitf(_wa, "Decoded array has the wrong size");
        for (int i = 0; i < n; ++i) {
            const int value = ouf.readInt(1, 26, "decodedValue");
            if (value != original[i]) {
                quitf(_wa, "Decoded array differs at index %d", i + 1);
            }
        }
        if (!ouf.seekEof()) quitf(_pe, "Unexpected data after the decoded array");
        quitf(_ok, "The array was recovered correctly");
    }

    quitf(_fail, "Unknown communicator mode");
}
