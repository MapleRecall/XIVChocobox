# 回响 · FF14 管弦乐播放器

仅使用浏览器读取用户本地 FINAL FANTASY XIV 安装的静态网页。目标为新版桌面 Chrome / Edge。

## 使用

1. 通过 HTTPS 静态站点或本地 HTTP 服务打开网页。
2. 点击“选择资源目录”，选择游戏的 `game/sqpack`；会读取 `ffxiv` 和 `ex1`～`ex5` 等已存在的资料片目录。也支持只选 `game/sqpack/ffxiv`。
3. 按管弦乐谱名称搜索、选择曲目播放。游戏配乐尚未关联 OST 名称，显示资源名和 BGM ID。
4. 进度条金色区域是原始循环区间，细线是资源中的 MARK。可拖动进度条跳转。
5. 设置循环段播放 1～999 遍，或无限循环。次数包含循环段首次播放；有限次数结束后继续尾声，然后停止，不自动切下一首。
6. 选中多声道曲目后，播放器会显示“多声道试听”。“全部声道”保留原始混音；六声道曲目还提供游戏变体预设：变体 1（FL+FC）、变体 2（FR+SL）、过渡强音（LFE+SR）。也可以点击单个 FL/FR/FC/LFE/SL/SR 声道独听。

暂停/继续及拖动保留已进行的循环次数；“从头”或播放结束后的“重播”重新计数。拖到尾声会跳过当前循环，播放中减少上限会在当前循环段结束时退出。无循环信息的曲目只播放一次。

## 本地运行与静态部署

需要 Node.js 22 或更新版本启动开发服务，不需要安装 npm 依赖：

```sh
npm run dev
```

打开 `http://127.0.0.1:4173/`。将 **dist 文件夹里的所有文件** 放到任意 HTTPS 静态托管即可部署；可以放到子路径。发布内容只有网页代码，无后端、无游戏文件、无构建步骤。服务器应将 `.js` 作为 JavaScript MIME 类型发送。

网页每次打开需要选择目录，仅申请只读权限。曲库、音乐读取、解包和解码均在本地；没有上传接口。只将循环和音量偏好保存在浏览器存储中，不复制整个游戏目录。

## 第一版边界

- 支持 SqPack `.index2` / `.index` 查找、标准资源分块解压，以及 EXH/EXD 表读取。
- 中文优先，游戏未提供中文数据时回退英语等可用语言；曲名来自本机 Orchestrion / OrchestrionPath，BGM 用于补全资源曲库。
- 支持 SCD v3 中的 OGG 包装版本 2 / 3。浏览器解码为 PCM，AudioWorklet 按采样点循环；44.1 kHz 到 48 kHz 的重采样会同步换算循环位置。多声道默认保持原始声道数量，声道/变体试听模式将选中的一个或多个声道平均后复制到前左/前右并静音其余输出。
- HCA 曲目显示明确的暂不支持提示；无音轨占位条目也会说明原因。未选择或缺失的资料片音乐禁用，不会误报为可播放。
- 当前一次解码一首曲目，不是流式 PCM 解码；估算 PCM 大于 320 MiB 时提示超出内存限制。切歌会释放上一首音频。多声道按浏览器扬声器规则输出；变体预设用于检查已观察到的声道规律，仍需更多资源验证后才能作为通用游戏逻辑。
- 当前已知的 Crystal Tower 类 5.1 资源规律：FL+FC 是变体 1，FR+SL 是变体 2，LFE+SR 是切换节点的过渡强音。播放器把这些预设混合到前左/前右用于试听；它们不是原始声道布局的永久修改。
- 循环优先使用 OGG Vorbis 的 LOOPSTART / LOOPEND / LOOPLENGTH；MARK 作为后备。SCD 外层压缩字节偏移不会误用为采样点。
- 浏览器后台播放由音频线程保持循环；操作系统休眠或浏览器强制挂起时仍会暂停。浏览器第一次播放需用户交互。

## 验证

```sh
npm test
npm run verify:game -- "<game/sqpack 路径>" --all
```

`tools/verify-game.mjs` 使用与网页完全相同的解析代码，仅读本地安装。`tools/audio-fixtures.mjs <sqpack 路径>` 是手动验证时才启动的临时回环服务，只提供四首固定样本，不属于发布目录。`tests/browser-audio.mjs` 在 Chrome 中验证实际 OGG 解码与 AudioWorklet 输出，不会自动播放测试音频。

2026-09-12 本机国服验证：2176 条曲库路径，2174 条可读取（2147 OGG、12 HCA、15 空资源），2 条安装内缺失；OGG 中 1996 条有有效循环信息，35 条有 MARK。Chrome 152 已验证单声道、立体声、六声道和资料片样本的 48 kHz 解码，并通过真实 AudioWorklet 的三遍循环、尾声和停止验证。

## 格式参考

- [xivres](https://github.com/Soreepeong/xivres) 的 SqPack、Excel 和 SCD 结构
- [vgmstream SCD parser](https://github.com/vgmstream/vgmstream/blob/master/src/meta/sqex_scd.c)
- [FFXIV SCD 格式研究](https://github.com/xivapi/ffxiv-datamining/blob/master/research/explorer_scd_files)
- [Web Audio](https://webaudio.github.io/web-audio-api/)

解析器为此项目实现；SCD XOR 表为文件格式常量。仓库不包含游戏音频或游戏数据表。
