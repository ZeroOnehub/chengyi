# 参与承艺开发

欢迎一起改承艺。流程是：**Fork 仓库 → 在自己的副本里改 → 提 PR → 负责人审核后合并**。

`main` 分支一合并，就会自动发布到 https://zeroonehub.github.io/chengyi/ ，所以所有改动都要走 PR。

动手前请先读 [`承艺_交接文档.md`](承艺_交接文档.md)，尤其是第三节「已经定下的决策」。视觉方向经过三轮评审才定下来，改界面时要守住那里列的几条。

## 一、拿到代码

1. 打开 https://github.com/ZeroOnehub/chengyi ，点右上角 **Fork**，在自己的账号下复制一份。
2. 把自己的副本下载到电脑：
   ```sh
   git clone https://github.com/<你的用户名>/chengyi.git
   cd chengyi
   ```
3. 以后开始新改动前，先在 GitHub 上自己的副本页面点 **Sync fork**，同步负责人那边的最新代码，再在本地 `git pull`。

## 二、在本地运行

### 只看原型（不带 AI）

不需要装任何东西，有 Python 3 就行（macOS 自带）。

- **macOS**：双击 `start.command`。
- **其他系统**：在仓库根目录运行下面的命令，再打开 http://127.0.0.1:5173 。
  ```sh
  python3 -m http.server 5173 --bind 127.0.0.1
  ```

直接双击 `index.html` 打不开，必须通过本地服务访问。这种方式下，承艺之声用的是规则演示。

### 带 AI 的完整版

承艺之声的大模型由 `server/` 里的讲解后台提供，后台再去调用 Dify 上的「非遗讲解人」应用和非遗知识库。

1. **装 Python 3.12 或更新的版本**：从 python.org 下载安装。
2. **装后台的运行环境**：在 `server/` 里执行下面的命令。Windows 上把 `.venv/bin/python` 换成 `.venv\Scripts\python`。
   ```sh
   python3 -m venv .venv
   .venv/bin/python -m pip install -r requirements.txt
   ```
3. **启动**：
   - **macOS**：双击 `启动承艺.command`。它会初始化后台、登记承艺的讲解条目，再把后台和原型一起启动，并打开浏览器。
   - **Windows**：双击 `启动承艺-Windows.bat`。
   - 整合版默认在8010端口同时提供页面和后台，入口为 `http://127.0.0.1:8010/chengyi/`。端口占用时启动器会选择后面的空闲端口，以窗口显示的地址为准。首次启动会安装依赖，需联网，启动后保持窗口打开。

   第一次启动时，`server/.env` 和管理员账号（`server/.local-credentials.txt`）会自动生成。此时后台是演示模式，承艺之声用规则版。
4. **填密钥，切换到大模型**：向负责人要 Dify 应用密钥，然后：
   1. 打开后台管理页 http://127.0.0.1:8010/admin ，用 `.local-credentials.txt` 里的账号登录；
   2. 进入「大模型接入」：平台选 Dify，地址填 `https://api.dify.ai/v1`，再填密钥；
   3. 点保存，再点测试连接。保存后后台立即切换到大模型模式，不用重启。

   想直接改 `server/.env` 也可以，要同时改这几行，改完重启后台：
   ```dotenv
   LLM_MODE=live
   LLM_PROVIDER=dify
   LLM_API_BASE_URL=https://api.dify.ai/v1
   LLM_MODEL=非遗讲解人
   LLM_API_KEY=负责人给的密钥
   ```

> **密钥只留在自己电脑上。** `server/.env` 和 `server/.local-credentials.txt` 已经被 `.gitignore` 排除。不要用 `git add -f` 强行加进去，也不要把它们贴进 PR、Issue 或聊天里。仓库是公开的，密钥一旦提交，必须立刻作废。

## 三、改代码

1. 在自己的副本里新建一个分支，名字说明要改什么，例如：
   ```sh
   git checkout -b fix-chat-panel
   ```
2. 找文件：前端改哪里，看交接文档第五节「代码地图」；后台看 `server/README.md` 和 `server/docs/`。
3. 一个 PR 只做一件事，方便审核，出问题也好回退。

## 四、提交前自查

- **冒烟测试**：在整合服务中打开 http://localhost:8010/chengyi/tests/smoke.html ，顶部应显示 `RESULT 45/45`。`/chengyi/tests/integration.html` 另有11项真实后台整合检查，请依次运行。单独静态原型仍可使用5173的 `/tests/smoke.html`。
- **改了后台**：在 `server/` 里运行下面的命令，要全部通过（目前102项）。
  ```sh
  .venv/bin/python -m pytest -q
  ```
- **改了界面**：把改动前后的样子截图放进 PR 说明。
- **改了交互或功能**：同步更新 `README.md` 和 `承艺_交接文档.md`。如果主流程变了，也要更新 `tests/smoke.html`。
- **确认没有密钥**：提交前看一眼 `git status`，不应该出现 `.env`、`.local-credentials.txt`、`server/data/`。

## 五、提 PR

1. 推到自己的副本：
   ```sh
   git push origin fix-chat-panel
   ```
2. 在 GitHub 上打开自己的副本，点 **Contribute → Open pull request**，目标选 `ZeroOnehub/chengyi` 的 `main`。
3. 按模板写清楚三件事：改了什么、为什么改、怎么验证的。
4. 负责人审核时可能会提修改意见。在同一个分支上继续提交、push，PR 会自动更新。
5. 合并后约一分钟，改动就会出现在线上。
