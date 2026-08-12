# Neural Tracker Map Studio

用于 G1 跟踪仿真的浏览器地图编辑器。默认地图为 `80 x 80 m`，地图单位为米，
世界坐标原点位于画布中心，`+X` 向右、`+Y` 向上。初始位置与
`src/simulator/config/simulator.yaml` 一致：tracker 为 `(-9.5, 0, 0°)`，
target 为 `(-7.0, 0, 0°)`。

## 本地运行

```bash
cd ~/Documents/neural_tracker/map_editor
npm run dev
```

浏览器打开 `http://localhost:3000`。选择障碍物、输入尺寸后点击“放置一个障碍物”，
再在画布中点击。已放置的障碍物可直接拖动；选中后也可精确调整坐标、旋转角度
和几何尺寸。拖动支持网格吸附及撤销/重做。

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
`run_tracking_mujoco.py` 通过 `NEURAL_TRACKER_SCENE_XML` 加载。矩形、旋转墙体、
圆柱和 L 型障碍在两侧使用相同的米制几何定义。
