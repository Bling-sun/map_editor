# Neural Tracker Map Studio

用于 G1 跟踪仿真的浏览器地图编辑器。默认地图为 `80 x 80 m`，地图单位为米，
世界坐标原点位于画布中心，`+X` 向右、`+Y` 向上。初始位置与
`src/simulator/config/simulator.yaml` 一致：tracker 为 `(-9.5, 0, 0°)`，
target 为 `(-7.0, 0, 0°)`。

默认地图四边包含与 `neural_tracker` 相同的锁定外墙：墙厚等于
`tracker.radius = 0.15 m`，在 `0.05 m` 分辨率下占 3 个栅格；导出时墙高为
`1.50 m`。外墙随地图尺寸自动贴边，不计入可拖动的内部障碍物。

## 本地运行

```bash
cd ~/Documents/neural_tracker/map_editor
npm run dev
```

浏览器打开 `http://localhost:3000`。选择障碍物、输入尺寸后点击“放置一个障碍物”，
再在画布中点击。已放置的障碍物可直接拖动；选中后也可精确调整坐标、旋转角度
和几何尺寸。拖动支持网格吸附及撤销/重做。
L 型墙的臂厚会按米制比例实时反映在画布预览中，并限制在 `0.05 m` 到该
L 型墙较短边长度之间。

形状库包括矩形、墙体、圆柱、L/E/T/H/S/F 组合墙，以及棱台、拱桥、树状三维
障碍物。组合墙由共享壁厚的矩形墙段构成；棱台可设置顶面比例，拱桥可设置净空，
树状障碍物可分别设置树干和树冠半径。

顶部“一键生成”可同时选择多种元素，为每种元素独立设置数量、平面尺寸范围和高度
范围。生成器按尺寸从大到小随机放置，并用覆盖任意旋转角度的外接安全圆检查外墙、
tracker/target 起点和其他障碍物；只有整张地图通过无重叠复核后才替换当前内部障碍物。
如果参数过密，原地图不会被修改。生成结果仍可在 2D/3D 中选择、拖动、修改和撤销。

画布工具栏可切换“2D 编辑”和“3D 预览”。3D 视图显示地面网格、外墙、障碍物、
tracker 和 target；点击模型可选中并同步属性检查器，拖动模型可修改 X/Y 坐标，
拖动空白区域可旋转视角，底部滑杆可缩放。3D 拖动同样支持网格吸附和撤销/重做。

2D 工具栏提供“框选”模式。在画布上拖出矩形即可批量选择与矩形相交的障碍物，
随后可点击“删除选中”或按 `Delete` / `Backspace` 一次删除；批量删除作为单次操作
写入历史记录，可直接撤销和重做。

## 用于仿真

编辑器提供两个互补文件：

- “保存工程”导出的 JSON 用于 ROS2 `/map`、`/tracker/scan` 和地图再编辑；
- “导出 MuJoCo XML”导出的 XML 用于物理碰撞和深度相机渲染。

两个文件必须来自同一次设计。当前 G1 ROS2 演示的自定义地图要求地图宽、高相同。

```bash
cd ~/Documents/neural_tracker
./g1_sim/build_ros_workspace.sh
./start_tracking_g1.sh \
  --map-json "$HOME/Downloads/g1_custom_test.json" \
  --scene-xml "$HOME/Downloads/g1_custom_test.xml"
```

JSON 会被栅格化为和现有 tracker 兼容的 `nav_msgs/OccupancyGrid`；XML 由
`run_tracking_mujoco.py` 通过 `NEURAL_TRACKER_SCENE_XML` 加载。所有基础、组合及
不规则三维障碍在画布、ROS 栅格化与 MuJoCo 导出中共享同一组米制参数。
