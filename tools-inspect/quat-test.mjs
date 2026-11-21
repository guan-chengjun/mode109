// 四元数旋转向量的纯数学计算，用于确认 GLB 模型加载后的世界朝向
// 运行: node tools-inspect/quat-test.mjs

// v' = v + 2 * cross(u, cross(u, v) + w * v)，q=(x,y,z,w) 为单位四元数
function rotate(q, v) {
  const [x, y, z, w] = q;
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  const u = [x, y, z];
  const t = cross(u, v).map((c, i) => c + w * v[i]); // cross(u,v) + w*v
  return v.map((vi, i) => vi + 2 * cross(u, t)[i]);
}

// Ferrari: main 节点旋转 (-0.5,-0.5,-0.5,0.5)，前轮在 main 局部 z=-1.155，后轮 z=+1.496
// 即 main 局部空间中车头朝 -Z，经 main 旋转后:
const qMain = [-0.5, -0.5, -0.5, 0.5];
const fwdLocal = [0, 0, -1];
const fwdWorld = rotate(qMain, fwdLocal);
console.log('Ferrari 局部 -Z (车头) 经 main 旋转后的世界向量:', fwdWorld.map(n => +n.toFixed(4)));

// 再看局部 +Y (车身向上方向) 转到哪
const upLocal = [0, 1, 0];
console.log('Ferrari 局部 +Y 经旋转后:', rotate(qMain, upLocal).map(n => +n.toFixed(4)));

// ToyCar 根节点旋转 (0.7071,0,0,0.7071) = 绕 X 轴 90°
const qToy = [0.7071, 0, 0, 0.7071];
console.log('ToyCar 局部 -Z 经根旋转后:', rotate(qToy, [0, 0, -1]).map(n => +n.toFixed(4)));
console.log('ToyCar 局部 +Y 经根旋转后:', rotate(qToy, [0, 1, 0]).map(n => +n.toFixed(4)));
