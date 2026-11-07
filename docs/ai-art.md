# 用本地图像模型生成素材

`examples/aria` 里的角色不是手画的，也不是从任何游戏里拆的，而是在本机跑图像模型生成、再用局部重绘做出差分。这一页记录怎么做，方便你自己复现或替换。

## 工具链

| 组成 | 版本 / 说明 |
|---|---|
| 推理 | OpenVINO 2026.4 + `openvino_genai`（`Text2ImagePipeline` / `InpaintingPipeline`） |
| 模型 | [Animagine XL 4.0](https://huggingface.co/cagliostrolab/animagine-xl-4.0) 的 OpenVINO 版（SDXL 架构，动漫向） |
| 设备 | Intel Arc iGPU（16 GB 共享显存），`832x1216`、26 步约 40 秒一张 |
| 抠图 | `rembg` + u2net，再做一次 alpha 清理（去白色光晕 / 地面阴影） |

模型本身不随仓库分发；你需要自己准备一份 OpenVINO 版的 SDXL 系动漫模型。

## 为什么用「局部重绘」做差分

分层差分必须像素级对齐。同一张底图上用 mask 重绘，mask 之外的像素完全不动，所以差分天然对齐：

1. 生成一张全身立绘（白底，便于抠图）。
2. 对眼睛带 / 嘴部 / 脸颊分别做 `InpaintingPipeline`，提示词只改表情，其余不变。
3. 从重绘结果里裁出 mask 区域，做羽化 alpha，得到「表情补丁」。
4. 换装时 mask 覆盖躯干与手臂，重绘成一整套新衣服；结果作为**整张角色图层**叠加在最上面（不透明的整图会把底图的旧衣服完全盖住）。

## 生成参数

```text
正面: masterpiece, high score, great score, absurdres, 1girl, solo, full body, standing,
      cute, chibi proportions, big sparkly eyes, pastel colors, soft lighting,
      white background, plain background, simple background, front view, looking at viewer
负面: lowres, bad anatomy, bad hands, text, error, signature, watermark, blurry,
      multiple views, multiple girls, nsfw, gradient background, scenery, sky, shadow, frame
尺寸: 832x1216，26 步，CFG 5.0，固定 seed
```

## 已知瑕疵

- 角色外缘还残留一点生成时的白色光晕，浅色背景上看不出来，深色背景上会有一圈淡边。
- 换装版的手臂姿势由重绘决定，和原图不完全一样；因为它是整张角色图层，所以观感上没问题。
- 表情补丁的羽化边缘在极近放大时能看到轻微接缝。

这些都不影响演示分层与配方；如果你要出正式素材，重复生成挑一张更干净的底图就行。

## 许可

模型权重遵循它自己的许可（Animagine XL 4.0 为 Fair AI Public License），本仓库只分发**生成出来的 PNG**，并把它们按 CC0 发布，方便你直接拿去用。替换成自己的模型/自己画的素材也没问题，插件只认 `pack.json`。
