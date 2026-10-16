# 阶段 1：定义 go-judge 来源
ARG GO_JUDGE_IMAGE=criyle/go-judge:v1.11.2
FROM ${GO_JUDGE_IMAGE} AS source

# Official GCC release, pinned to the multi-platform image digest. Bookworm's
# glibc is older than Ubuntu 24.04's; do not substitute a newer distro image.
FROM gcc:15.2.0-bookworm@sha256:9ca91b05c7b07d2979f16413e8b2cd6ec8a7c80ffca4121ccab0aeba33f90460 AS toolchain

# 阶段 2：构建实际运行环境
FROM ubuntu:24.04

# 设置环境变量
ENV TZ=America/Vancouver
ENV DEBIAN_FRONTEND=noninteractive

# 修改源 (可选)
RUN sed -i 's@//.*archive.ubuntu.com@//mirrors.aliyun.com@g' /etc/apt/sources.list.d/ubuntu.sources && \
    sed -i 's@//.*security.ubuntu.com@//mirrors.aliyun.com@g' /etc/apt/sources.list.d/ubuntu.sources && \
    sed -i 's@http://ports.ubuntu.com/ubuntu-ports@http://mirrors.huaweicloud.com/ubuntu-ports@g' /etc/apt/sources.list.d/ubuntu.sources

# =========================================================
# Install the system linker/headers used by the pinned GCC toolchain.
# =========================================================
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && sed -i 's@http://mirrors@https://mirrors@g' /etc/apt/sources.list.d/ubuntu.sources \
    && apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
    locales \
    binutils libc6-dev libzstd1 \
    python3 pypy3 openjdk-21-jdk-headless \
    vim curl \
    && rm -rf /var/lib/apt/lists/*

# =========================================================
# GCC 15.2 includes the PR c++/113835 fix for global constexpr vector trials.
# Preserve /usr/bin paths used by both submission and judge-program compilers.
# =========================================================
COPY --from=toolchain /usr/local/ /usr/local/
RUN update-alternatives --install /usr/bin/gcc gcc /usr/local/bin/gcc 100 \
    && update-alternatives --install /usr/bin/g++ g++ /usr/local/bin/g++ 100 \
    && update-alternatives --install /usr/bin/cc cc /usr/local/bin/gcc 100 \
    && update-alternatives --install /usr/bin/c++ c++ /usr/local/bin/g++ 100 \
    && printf '/usr/local/lib64\n/usr/local/lib\n' > /etc/ld.so.conf.d/00-gcc.conf \
    && ldconfig \
    && test "$(/usr/bin/gcc -dumpfullversion)" = "15.2.0" \
    && test "$(/usr/bin/g++ -dumpfullversion)" = "15.2.0"

# 2. 生成语言包 (解决 LC_ALL 报错)
RUN locale-gen en_US.UTF-8
ENV LANG=en_US.UTF-8
ENV LANGUAGE=en_US:en
ENV LC_ALL=en_US.UTF-8

# =========================================================
# 【核心修复】修复 Java 配置文件软链接问题
# 注意：JDK 目录名随架构变化，不能写死：
#   amd64 -> java-21-openjdk-amd64
#   arm64 -> java-21-openjdk-arm64 (Apple Silicon 等)
# 这里用通配符动态解析实际目录，并额外建立 amd64 兼容软链接，
# 保证 lib/judge.ts 中硬编码的 java-21-openjdk-amd64 路径
# 在 arm64 镜像上同样可用。
# =========================================================
RUN JDK_DIR=$(ls -d /usr/lib/jvm/java-21-openjdk-*) && \
    cp -rL "$JDK_DIR/conf" /tmp/java-conf && \
    rm -rf "$JDK_DIR/conf" && \
    mv /tmp/java-conf "$JDK_DIR/conf" && \
    if [ ! -e /usr/lib/jvm/java-21-openjdk-amd64 ]; then \
        ln -s "$JDK_DIR" /usr/lib/jvm/java-21-openjdk-amd64; \
    fi

WORKDIR /opt

# 拷贝 go-judge 二进制文件
COPY --from=source /opt/go-judge /opt/go-judge

EXPOSE 5050 5051

# 启动
ENTRYPOINT ["/opt/go-judge", "-http-addr", "0.0.0.0:5050"]
