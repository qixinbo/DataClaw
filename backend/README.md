# Backend 打包说明

## Wheel 内置前端产物

- 前端构建目录固定为 `frontend/dist`
- wheel 构建时通过 `backend/pyproject.toml` 中的 `tool.hatch.build.targets.wheel.force-include` 映射到包内 `app/webui`
- 安装后可通过 `importlib.resources.files("app").joinpath("webui/index.html")` 读取前端入口文件

## 构建顺序

```bash
cd frontend
npm install
npm run build

cd ../backend
uv build
```
