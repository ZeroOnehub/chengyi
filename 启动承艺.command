#!/bin/bash
cd "$(dirname "$0")/server" || exit 1
for candidate in .venv/bin/python python3.14 python3.13 python3.12 python3; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3,12))' >/dev/null 2>&1; then
    "$candidate" scripts/launch_shared.py --port 8010
    status=$?
    if [ "$status" -ne 0 ]; then read -r -p "按回车关闭窗口。"; fi
    exit "$status"
  fi
done
echo "请先安装 Python 3.12 或更新版本，再启动承艺。"
read -r -p "按回车关闭窗口。"
