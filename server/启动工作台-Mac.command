#!/bin/bash
cd "$(dirname "$0")" || exit 1
export PYTHONUTF8=1
run_workbench() {
  "$1" scripts/launch_shared.py 2>&1 | tee "启动日志.txt"
  status=${PIPESTATUS[0]}
  if [ "$status" -ne 0 ]; then
    echo "启动没有完成，请把文件夹里的“启动日志.txt”发给项目负责人。"
    read -r -p "按回车关闭窗口。"
  fi
  exit "$status"
}
# 压缩包自带运行环境时直接用它，对方不用装 Python。
for bundled in runtime/python/bin/python3 runtime/python/bin/python3.12; do
  if [ -f "$bundled" ]; then
    if [ "$(uname -m)" = "x86_64" ] && /usr/bin/file "$bundled" | /usr/bin/grep -q 'arm64'; then
      echo "这个免安装包适用于 Apple 芯片 Mac；当前电脑使用 Intel 芯片。"
      echo "请使用 Intel 版本，或安装 Python 3.12 后使用源码分享版。"
      read -r -p "按回车关闭窗口。"
      exit 1
    fi
    if [ ! -x "$bundled" ]; then
      echo "运行文件缺少执行权限，请重新完整解压压缩包。"
      read -r -p "按回车关闭窗口。"
      exit 1
    fi
    run_workbench "$bundled"
  fi
done
# 没有自带环境时，先在 PATH 里找，再找常见安装位置。
for candidate in python3.14 python3.13 python3.12 python3 python \
  /opt/homebrew/bin/python3.14 /opt/homebrew/bin/python3.13 /opt/homebrew/bin/python3.12 \
  /usr/local/bin/python3.14 /usr/local/bin/python3.13 /usr/local/bin/python3.12 \
  /Library/Frameworks/Python.framework/Versions/3.1*/bin/python3 \
  "$PWD/.venv/bin/python"; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 12))' >/dev/null 2>&1; then
    run_workbench "$candidate"
  fi
done
echo "没有找到 Python 3.12 或更新版本。"
echo "请打开 https://www.python.org/downloads/ 下载安装 Python 3.12 以上版本，装好后再双击本文件。"
read -r -p "按回车关闭窗口。"
exit 1
