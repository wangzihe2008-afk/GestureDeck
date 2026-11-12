# GestureDeck

用自己的身体姿势控制演示。这个项目为 VS Code 本地开发交付，包含网站完整源码、Chrome 连接器源码与已构建版本、本地骨骼模型、示例 PDF、测试和中文说明。

网站界面、操作指南、状态提示及连接器错误信息已统一为英文。本文件和技术文档保留中文，方便阅读与学习。用户自行输入的姿势名称不会被翻译。旧版动态动作配置仍可导入，但建议重新捕捉成静态姿势以获得更稳定的外部演示识别。

## 先运行起来

1. 安装 **Node.js 22.12 或更新版本**（推荐 Node.js 24 LTS）、VS Code 和桌面版 Chrome。
2. 解压压缩包，在 VS Code 选择 **File → Open Folder → GestureDeck**。必须打开包含 `package.json` 的那一层。
3. 选择 **Terminal → New Terminal**，依次运行：

```bash
npm install
npm run dev
```

4. Chrome 打开 **http://localhost:5173**。

不要双击 `index.html`，也不需要安装 Live Server。终端里的开发服务器需要保持运行；`Ctrl + C` 停止。连接器使用固定的 `5173` 端口，若端口被其他项目占用，先关闭占用进程。

模型、WASM、PDF 字体资源已经包含在项目中。`npm install` 安装代码依赖，需要网络；运行时摄像头和 PDF 均在本机处理，无付费 API、无需账号或 API key。首次安装自动执行 `npm run setup`，复制与锁定依赖匹配的资源；模型不存在时才从 Google 官方地址下载。

## 先试 PDF，再试姿势

1. 在「PDF 演示」点击「先试试示例演示」，确认上一页、下一页、黑屏和全屏可用。
2. 进入 **Pose Studio**，启动摄像头，站到实际演讲位置。
3. 让双肩、双肘和双手腕保持可见。实时骨骼面板的 **Pose readiness → Ready to use** 表示可以捕捉和识别；不需要追求 100 分。显示 **Adjust camera** 时，按提示调整镜头和站位。
4. 输入名字（如 `Right arm raised`），选择 `Next slide`，点击 **Capture pose**。
5. 在 3 秒倒计时内摆好姿势，然后保持约 0.7 秒。系统会从短暂的多帧采样中生成一个稳定姿势模板，不需要再录第二遍。
6. 保存后，为上一页捕捉一个明显不同的姿势。
7. 在 **Test Lab** 启用测试，确认自然说话时不会误触，而且每次放下手后都能再次触发。
8. 回到「PDF 演示」，上传自己的 PDF，启用摄像头和控制，再进入全屏。

模板只保存二维上半身关键点，不保存摄像头照片、录像或声音。左右是**人体解剖学上的左右**；画面只是镜像显示。每次指令执行后，必须先离开该姿势并回到自然站姿，才能再次触发。

### 键盘备用操作

| 操作            | PDF 模式                            | 外部模式                           |
| --------------- | ----------------------------------- | ---------------------------------- |
| 下一页 / 上一页 | `→` / `←`，也支持 PageDown / PageUp | 演示平台自己的快捷键               |
| 黑屏 / 恢复     | `B` 或页面按钮                      | 捕捉并映射「黑屏」，使用本地覆盖层 |
| 应急暂停        | `Esc` 或 `Alt + Shift + G`          | `Alt + Shift + G` 暂停 / 恢复      |
| 彻底关闭摄像头  | 页面「关闭摄像头」                  | 网站「停止」或点击扩展图标         |

自定义「暂停 / 继续」姿势出于防误恢复的考虑只执行暂停；恢复使用按钮或外部连接器的固定快捷键。PDF 网站切到后台时自动暂停控制，回来后手动重新启用；外部模式的识别在连接器 offscreen 页面运行。

## Google Slides / Canva 连接器

压缩包已提供 **`connector/dist`**，可以直接加载；修改源码后运行：

```bash
npm run build:connector
```

1. Chrome 打开 `chrome://extensions`，开启右上角「开发者模式」。
2. 点击「加载已解压的扩展程序」，选 **`GestureDeck/connector/dist`**，不要选 `connector/src` 或项目根目录。
3. 安装后**刷新 GestureDeck 网站以及已打开的演示标签页**。
4. 在同一个 Chrome 个人资料中打开 Google Slides 或 Canva 的编辑页。网站进入「外部演示」，选择平台并选择标有 **Editor** 的目标标签页。
5. 点击「打开摄像头授权页面」，在连接器页面点击 `Allow camera` 并允许权限，再回到网站。
6. 点击 **Start camera check**。网站会显示连接器后台摄像头的本地预览与具体姿势提示；出现 **Ready for Present** 前不要进入全屏。
7. 回到目标页点击 **Slideshow / Present**，之后不需要回到 GestureDeck。如果它打开成新标签页，连接器会根据 opener、当前活动标签页和演示 URL 自动跟随 **Slideshow**；如果你已经提前打开了演示页，刷新列表并直接选择标有 **Slideshow** 的项目。
8. 手动上一页 / 下一页只在连接器确认目标为 Slideshow 后启用，作为进入全屏前的可选适配器测试。

只控制选中的标签页，不会随着你切换到其他无关网页而发送命令。关闭控制网站/目标标签页会停止会话。网站会检查连接器版本；如果仍加载旧版，会明确要求在 `chrome://extensions` 重新加载当前 `connector/dist`。扩展快捷键若冲突，可在 `chrome://extensions/shortcuts` 修改。

**实际验证范围：**识别算法、原生摄像头帧读取、帧资源释放、冻结处理、摄像头就绪检查、冷却期间放下手后重复触发、暂停和目标跟随都有自动化测试；适配器有模拟 DOM 测试。交付环境没有用户的真实摄像头，也没有在已登录的 Google Slides / Canva 上完成现场端到端验证。使用时先按第 6 步确认后台摄像头就绪，再按第 7 步连续测试姿势翻页。

下一页和上一页优先向选中的 Chrome 演示标签页发送浏览器级方向键；若连接失败，再尝试平台导航按钮。按钮后备方式会检查页码或 URL 变化。浏览器接受按键代表命令已发送，不代表已实测看到页面变化。Canva UI 更新、内嵌播放器或边界页都可能影响兼容性。这里只控制**网页演示**，不控制桌面 PowerPoint。

**升级到连接器 1.8.0：**先导出 JSON 备份，在 `chrome://extensions` 移除指向旧项目文件夹的连接器，再从新文件夹的 `connector/dist` 加载并刷新 GestureDeck 和演示页。外部预览直接使用摄像头帧，通过 WebP 编码发送。识别在独立线程运行，优先使用 GPU，失败后自动改用 CPU。

外部模式分别显示实测的 **Camera FPS**、**Recognition FPS** 和 **Preview FPS**。在进入演示前查看三项数值，可以区分摄像头供帧、姿势识别和页面预览的速度。**poses detected** 和 **slide commands sent** 分别计数识别和发出的命令。Google Slides 全屏时可以留在演示页。已有静态姿势可以直接继续使用。

## 配置、备份与调参

- 「My poses → Export」保存 JSON；「Import」合并姿势，同 ID 更新。重新导入前先备份。
- 最多 30 个姿势，文件最大 2 MB。只在你使用的浏览器和网站地址中保存；清理浏览器数据会移除配置。
- 项目默认通过平移和肩宽缩放消除画面位置与人物大小的影响，但**不是任意距离、角度和多人场景都能识别**。尽量面向摄像头，保持相近拍摄角度。
- `threshold` 是允许的归一化骨骼距离，数值越小越严格。建议先换更明确的姿势；确需调参，可导出 JSON，调整 `threshold`（0.10–0.50）和 `cooldownMs`（600–5000），再导入。系统自动计算的初始阈值只是启发式起点。
- UI 的「匹配指数」是距离经过指数映射的显示值，**不是实测准确率、置信概率或识别成功率**。
- 0.7 秒捕捉会用多个骨骼帧求稳定姿势，并不是训练一个通用深度学习模型。真正识别率必须通过真人测试测量。

## 常用开发命令

```bash
npm run dev              # 开发网站
npm run typecheck        # TypeScript 检查
npm test                 # 算法与模拟网页适配器测试
npm run build            # 检查 + 网站生产构建 + 连接器构建
npm run preview          # 在 localhost:5173 预览 dist 网站
npm run build:connector  # 重新生成 connector/dist 和可下载连接器 ZIP
```

`dist` 和 `node_modules` 是生成文件，不包含在源项目压缩包中。运行 `npm install`、`npm run build` 即可重新生成。**已构建连接器包含在压缩包的 `connector/dist` 中。**

## 项目目录

```text
GestureDeck/
  src/
    core/           标准化、静态姿势匹配、旧版 DTW、状态机、配置验证
    vision/         摄像头、MediaPipe、骨骼绘制
    pdf/            PDF.js 加载与并发安全渲染
    bridge/         网站与连接器的消息客户端
    components/     姿势捕捉、PDF、摄像头、外部控制、姿势卡片
    App.tsx         导航、全局状态和指令分发
    styles.css      响应式界面
  connector/
    src/            background、offscreen、bridge、presentation、adapters
    dist/           可直接加载的 Chrome 扩展
  public/
    models/         本地 Pose Landmarker Lite 及来源哈希
    wasm/           MediaPipe WASM
    pdf-assets/     PDF.js CMap、标准字体、WASM
    demo.pdf        五页演示样例
    connector.zip   已构建连接器下载包
  tests/            核心算法及适配器测试
  docs/             架构、验收步骤、第三方说明
  scripts/          资源准备、构建、打包、样例生成
  package-lock.json 锁定依赖版本
```

建议阅读顺序：`src/core/normalize.ts` → `dtw.ts` → `trainer.ts` → `recognizer.ts` → `src/App.tsx` → `connector/src/background.ts`。

## 常见问题

**`npm` 找不到：**安装 Node.js 后完全退出并重开 VS Code。Mac M 系列与 Intel 均运行同一套源代码；不要复制别人的 `node_modules`。

**Mac 摄像头拒绝：**在 Chrome 地址栏网站设置允许摄像头；系统设置 → 隐私与安全性 → 摄像头允许 Chrome。连接器授权在独立扩展页面完成。若有其他应用独占设备，关闭它再重试。

**模型加载失败：**确认 `public/models/pose_landmarker_lite.task` 存在，运行 `npm run setup`。模型补下载需要访问 `storage.googleapis.com`。项目已带模型，正常不需重新下载。

**骨骼不稳定：**补光、避免背光、避免多人进入画面、放大人物或调整站位，让所有手臂关节入镜。未检测到可靠关键点时不触发指令。

**实时骨骼需要达到 100 分吗：**不需要。旧版数字取双肩、双肘、双手腕中最低的关键点置信度，不是完成进度，也不是识别准确率。六点置信度至少 0.55、关节在画面安全区内且肩宽合适时就接受该帧。新版直接显示 **Ready to use / Adjust camera**，以实际可用姿势为准。镜头摆正，对准上半身，保持双手腕入镜；只拍到脸时不能捕捉手臂姿势。

**明明识别过一次，第二次不触发：**确认网站和连接器版本一致。翻页后放下手回到自然站姿约半秒，再摆出已保存姿势。外部模式会在冷却期间记录放下手。一直保持同一姿势只触发一次。

**外部控制没连接：**用 Chrome，地址必须是 `localhost:5173` 或 `127.0.0.1:5173`，安装扩展后刷新。Safari / Firefox 不支持此 Manifest V3 offscreen 实现。外部模式关闭时，网站 PDF 模式仍可独立使用。

**演讲中误触：**暂停控制，降低灵敏度（减小 threshold），或捕捉更独特的姿势。不要把普通说话时常出现的站姿或手势作为翻页指令。

## 学习与提交

这是可运行的开发项目。交 ICS4U 作业前，请对照老师要求，理解代码并自行实测、修改。`docs/ARCHITECTURE.md` 解释算法与 OOP，`docs/TESTING.md` 提供验收表格。不要把模拟测试结果当作真人识别率，也不要把生成代码声称为全部独立编写。

第三方来源和许可证见 `docs/THIRD_PARTY.md`。
